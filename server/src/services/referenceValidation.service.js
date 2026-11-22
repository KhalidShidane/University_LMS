import mongoose from 'mongoose'

export class ReferenceIntegrityError extends Error {
  constructor(field, message) {
    super(message)
    this.name = 'ReferenceIntegrityError'
    this.field = field
    this.status = 400
  }
}

export async function getExistingReferences(Model, ids, field) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean).map(String))]
  if (!uniqueIds.length) return []

  for (const id of uniqueIds) {
    if (!mongoose.isValidObjectId(id)) {
      throw new ReferenceIntegrityError(field, `${field} contains an invalid reference`)
    }
  }

  const documents = await Model.find({ _id: { $in: uniqueIds } }).select('_id').lean()
  if (documents.length !== uniqueIds.length) {
    throw new ReferenceIntegrityError(field, `One or more ${field} references do not exist`)
  }
  return documents
}

export async function getExistingDocuments(Model, ids, projection, field) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean).map(String))]
  if (!uniqueIds.length) return []

  for (const id of uniqueIds) {
    if (!mongoose.isValidObjectId(id)) {
      throw new ReferenceIntegrityError(field, `${field} contains an invalid reference`)
    }
  }

  const documents = await Model.find({ _id: { $in: uniqueIds } }).select(projection).lean()
  if (documents.length !== uniqueIds.length) {
    throw new ReferenceIntegrityError(field, `One or more ${field} references do not exist`)
  }
  return documents
}
