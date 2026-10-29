// Detect accidental JSON corruption in new exports. A checksum is not an
// authentication signature and does not replace D1 transactional guarantees.
export async function backupDigest(data) {
  const { integrity, ...body } = data
  const bytes = new TextEncoder().encode(JSON.stringify(body))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}
export async function sealBackup(data) {
  return { ...data, integrity: { algorithm: 'SHA-256', sha256: await backupDigest(data) } }
}
export async function verifyBackupIntegrity(data) {
  // Old v1/v2/v3 backups did not include a checksum. Keep them recoverable.
  if (data.integrity == null) return true
  if (data.integrity.algorithm !== 'SHA-256' ||
      !/^[a-f0-9]{64}$/.test(data.integrity.sha256 || ''))
    throw Error('バックアップの検証情報が不正です')
  if (await backupDigest(data) !== data.integrity.sha256)
    throw Error('バックアップの内容が保存後に変わっています')
  return true
}
