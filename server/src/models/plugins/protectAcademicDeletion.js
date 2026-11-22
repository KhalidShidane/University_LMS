export class AcademicRecordInUseError extends Error {
  constructor(message = 'This academic record is still referenced; deactivate it instead') {
    super(message)
    this.name = 'AcademicRecordInUseError'
    this.status = 409
  }
}

export default function protectAcademicDeletion(schema, { countReferences }) {
  const assertUnreferenced = async (id) => {
    if (!id || await countReferences(id)) throw new AcademicRecordInUseError()
  }

  schema.pre('findOneAndDelete', async function protectFindOneAndDelete() {
    await assertUnreferenced(this.getQuery()._id)
  })

  schema.pre('deleteOne', { document: false, query: true }, async function protectQueryDeleteOne() {
    await assertUnreferenced(this.getQuery()._id)
  })

  schema.pre('deleteOne', { document: true, query: false }, async function protectDocumentDeleteOne() {
    await assertUnreferenced(this._id)
  })

  schema.pre('deleteMany', function preventBulkDelete() {
    throw new AcademicRecordInUseError('Bulk deletion is disabled; deactivate records instead')
  })
}
