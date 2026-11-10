// The text-paste tool and the image OCR tool own separate card selections.
// Keep this independent of the OCR document type: receipts can also be paid by
// a user-selected card, and an explicit selection wins over OCR guesses.
export function selectedImportCard(fromImage, manualChoice = '', imageChoice = '') {
  return (fromImage ? imageChoice : manualChoice) || ''
}
