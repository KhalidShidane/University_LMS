import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import protectAcademicDeletion, { AcademicRecordInUseError } from './protectAcademicDeletion.js'

const protectedSchema = new mongoose.Schema({ label: String })
protectedSchema.plugin(protectAcademicDeletion, { countReferences: async () => 1 })
const ProtectedRecord = mongoose.models.ProtectedRecord
  || mongoose.model('ProtectedRecord', protectedSchema)

test('referenced records cannot be deleted through query or document deletion APIs', async () => {
  const id = new mongoose.Types.ObjectId()
  await assert.rejects(
    ProtectedRecord.findByIdAndDelete(id).exec(),
    (error) => error instanceof AcademicRecordInUseError,
  )
  await assert.rejects(
    ProtectedRecord.deleteOne({ _id: id }).exec(),
    (error) => error instanceof AcademicRecordInUseError,
  )
  await assert.rejects(
    ProtectedRecord.deleteMany({}).exec(),
    (error) => error instanceof AcademicRecordInUseError,
  )
  await assert.rejects(
    new ProtectedRecord({ _id: id, label: 'referenced' }).deleteOne(),
    (error) => error instanceof AcademicRecordInUseError,
  )
})
