// Compress receipt photos entirely on-device. OCR must use the original image.
export async function compressReceiptImage(file, maxEdge = 1200, maxBytes = 200 * 1024) {
  if (!file?.type?.startsWith('image/')) throw new Error('画像ファイルを選択してください')
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('画像を処理できません')
    const encode = quality => new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality))
    // Progressive downsizing avoids rejecting normal multi-megabyte iPhone photos.
    // Keep the largest legible image that fits the device-only storage budget.
    for (const edge of [maxEdge, 1100, 1000, 900, 800, 700, 600, 500, 400]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.8, 0.7, 0.6, 0.5, 0.4, 0.3]) {
        const blob = await encode(quality)
        if (blob?.type === 'image/webp' && blob.size <= maxBytes) return blob
      }
    }
    // Extremely noisy images may still exceed the budget; keep reducing
    // rather than forcing the user to edit their camera photo manually.
    for (const edge of [320, 240, 160]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await encode(0.35)
      if (blob?.type === 'image/webp' && blob.size <= maxBytes) return blob
    }
    throw new Error('画像の圧縮に失敗しました。もう一度お試しください')
  } finally {
    bitmap.close?.()
  }
}
