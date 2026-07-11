const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function stripExifAndEncrypt(file, quality = 0.75) {
  const isImage = file.type.startsWith('image/');

  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File too large. Maximum is 5MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)}MB`);
  }

  if (!isImage) {
    const fileKey = crypto.getRandomValues(new Uint8Array(32));
    const fileIv = crypto.getRandomValues(new Uint8Array(12));
    const aesKey = await crypto.subtle.importKey('raw', fileKey, 'AES-GCM', false, ['encrypt']);
    const fileBuffer = await blobToArrayBuffer(file);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: fileIv }, aesKey, fileBuffer);

    return {
      ciphertext: new Uint8Array(ciphertext),
      key: fileKey,
      iv: fileIv,
      thumbnail: null,
      thumbnailIv: null,
      mimeType: file.type,
      filename: file.name,
      size: file.size,
      isImage: false,
      estimatedUploadSize: ciphertext.byteLength,
    };
  }

  const img = await loadImage(URL.createObjectURL(file));
  const webpBlob = await canvasToWebP(img, quality);
  const webpBuffer = await blobToArrayBuffer(webpBlob);

  if (webpBlob.size > MAX_FILE_BYTES) {
    throw new Error(`Image too large after conversion. Maximum is 5MB. Your file: ${(webpBlob.size / 1024 / 1024).toFixed(1)}MB`);
  }

  const thumbCanvas = document.createElement('canvas');
  const thumbSize = 64;
  thumbCanvas.width = thumbSize;
  thumbCanvas.height = thumbSize;
  const tctx = thumbCanvas.getContext('2d');
  tctx.filter = 'blur(6px)';
  tctx.drawImage(img, 0, 0, thumbSize, thumbSize);
  const thumbBlob = await canvasToWebP(thumbCanvas, 0.3);
  const thumbBuffer = await blobToArrayBuffer(thumbBlob);

  const fileKey = crypto.getRandomValues(new Uint8Array(32));
  const fileIv = crypto.getRandomValues(new Uint8Array(12));
  const thumbIv = crypto.getRandomValues(new Uint8Array(12)); // separate IV for thumbnail
  
  const aesKey = await crypto.subtle.importKey('raw', fileKey, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: fileIv }, aesKey, webpBuffer);
  const encryptedThumb = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: thumbIv }, aesKey, thumbBuffer);

  return {
    ciphertext: new Uint8Array(ciphertext),
    key: fileKey,
    iv: fileIv,
    thumbnail: new Uint8Array(encryptedThumb),
    thumbnailIv: thumbIv, // returned so receiver can decrypt thumbnail
    mimeType: 'image/webp',
    filename: file.name.replace(/\.[^.]+$/, '.webp'),
    size: webpBlob.size,
    isImage: true,
    originalSize: file.size,
    estimatedUploadSize: ciphertext.byteLength,
  };
}

export async function decryptFile(ciphertext, key, iv) {
  const aesKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  return await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function canvasToWebP(source, quality) {
  return new Promise((resolve, reject) => {
    let canvas;
    if (source instanceof HTMLCanvasElement) {
      canvas = source;
    } else {
      const maxDim = 2048;
      let w = source.naturalWidth;
      let h = source.naturalHeight;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.floor(w * ratio);
        h = Math.floor(h * ratio);
      }
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(source, 0, 0, w, h);
    }

    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('WebP conversion failed'));
      },
      'image/webp',
      quality
    );
  });
}

function blobToArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}