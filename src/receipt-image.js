// Compress receipt photos on-device before uploading to temporary storage.
// Never run this for card statements.
export async function compressReceiptImage(file, maxEdge = 1200, maxBytes = 200 * 1024) {
  if (!file?.type?.startsWith('image/')) throw new Error('画像ファイルを選択してください')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('画像を処理できません')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const encode = quality => new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality))
    for (const quality of [0.78, 0.65, 0.52, 0.4]) {
      const blob = await encode(quality)
      if (blob?.type === 'image/webp' && blob.size <= maxBytes) return blob
    }
    throw new Error('画像が200KBを超えています。別の写真を選択してください')
  } finally {
    bitmap.close?.()
  }
}
