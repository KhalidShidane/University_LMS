import mongoose from 'mongoose'
import { academicModels, countAcademicReferences, findAcademicRecord, setAcademicRecordActive } from '../repositories/academic.repository.js'

export class AcademicStructureError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'AcademicStructureError'
    this.status = status
  }
}

function validateRecordId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new AcademicStructureError('A valid record ID is required', 400)
  }
}

export async function getAcademicRecord(type, id) {
  validateRecordId(id)
  const record = await findAcademicRecord(type, id)
  if (!record) throw new AcademicStructureError('Academic record was not found', 404)
  return record
}

export async function deactivateAcademicRecord(type, id) {
  validateRecordId(id)
  if (!academicModels[type]) throw new TypeError(`Unknown academic record type: ${type}`)
  const record = await setAcademicRecordActive(type, id, false)
  if (!record) throw new AcademicStructureError('Academic record was not found', 404)
  return record
}

export async function assertAcademicRecordCanBeDeleted(type, id) {
  validateRecordId(id)
  if (!academicModels[type]) throw new TypeError(`Unknown academic record type: ${type}`)
  const references = await countAcademicReferences(type, id)
  if (references > 0) {
    throw new AcademicStructureError('This record is still referenced; deactivate it instead', 409)
  }
}
