import mongoose from 'mongoose'

const auditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  action: { type: String, required: true, trim: true, maxlength: 100, index: true },
  resourceType: { type: String, required: true, trim: true, maxlength: 80, index: true },
  resourceId: { type: String, default: '', maxlength: 100, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: { type: String, default: '', maxlength: 64 },
  userAgent: { type: String, default: '', maxlength: 300 },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false })

auditLogSchema.pre('save', function preventAuditEdits() {
  if (!this.isNew) throw new Error('Audit logs are immutable')
})

for (const op of ['findOneAndUpdate', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  auditLogSchema.pre(op, function rejectAuditMutation() { throw new Error('Audit logs are immutable') })
}
auditLogSchema.pre('insertMany', function rejectAuditInsertMany() { throw new Error('Audit logs must be created through the audit service') })
auditLogSchema.index({ createdAt: -1 })

export default mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema)
