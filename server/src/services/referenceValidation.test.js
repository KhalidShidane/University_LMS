import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { getExistingReferences, ReferenceIntegrityError } from './referenceValidation.service.js'

function fakeModel(foundDocuments) {
  return {
    find() {
      return {
        select() {
          return { lean: async () => foundDocuments }
        },
      }
    },
  }
}

test('reference validation accepts existing ObjectId references', async () => {
  const id = new mongoose.Types.ObjectId()
  const result = await getExistingReferences(fakeModel([{ _id: id }]), [id], 'faculty')
  assert.equal(result.length, 1)
})

test('reference validation rejects malformed ObjectIds', async () => {
  await assert.rejects(
    getExistingReferences(fakeModel([]), ['invalid-id'], 'faculty'),
    (error) => error instanceof ReferenceIntegrityError && error.field === 'faculty',
  )
})

test('reference validation rejects IDs that do not resolve to documents', async () => {
  const id = new mongoose.Types.ObjectId()
  await assert.rejects(
    getExistingReferences(fakeModel([]), [id], 'department'),
    /references do not exist/,
  )
})
