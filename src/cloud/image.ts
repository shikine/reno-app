// 画像をブラウザ側で縮小・JPEG圧縮して data URL にする（アップロード軽量化）。

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('画像の読み込みに失敗しました'))
    r.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('画像を開けませんでした'))
    img.src = src
  })
}

// maxDim: 長辺の最大px, quality: 0..1
export async function compressImage(file: File, maxDim = 1280, quality = 0.7): Promise<string> {
  const dataUrl = await readAsDataURL(file)
  const img = await loadImage(dataUrl)
  let w = img.naturalWidth || img.width
  let h = img.naturalHeight || img.height
  if (Math.max(w, h) > maxDim) {
    const s = maxDim / Math.max(w, h)
    w = Math.round(w * s); h = Math.round(h * s)
  }
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

// 写真の表示URL（Drive ファイルID → サムネイル、data URL はそのまま）
export function photoThumb(p: string, size = 400): string {
  if (p.startsWith('data:')) return p
  return `https://drive.google.com/thumbnail?id=${p}&sz=w${size}`
}

// 写真を開くURL（Drive のプレビュー）
export function photoOpen(p: string): string {
  if (p.startsWith('data:')) return p
  return `https://drive.google.com/file/d/${p}/view`
}
