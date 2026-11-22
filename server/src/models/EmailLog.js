import mongoose from 'mongoose'

// One record per email the system tries to send; used for troubleshooting and quota accounting.
// Never stores message bodies, tokens, or provider credentials.
const emailLogSchema = new mongoose.Schema({
  type: { type: String, required: true, trim: true, maxlength: 60, index: true },
  recipientUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  recipientEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  subject: { type: String, trim: true, maxlength: 300, default: '' },
  provider: { type: String, trim: true, maxlength: 30, default: '' },
  status: { type: String, required: true, enum: ['sent', 'failed', 'skipped'], index: true },
  providerMessageId: { type: String, trim: true, maxlength: 120, default: '' },
  errorCode: { type: String, trim: true, maxlength: 60, default: '' },
  errorMessage: { type: String, trim: true, maxlength: 500, default: '' },
}, { timestamps: true, versionKey: false })

emailLogSchema.index({ createdAt: -1 })

const EmailLog = mongoose.models.EmailLog || mongoose.model('EmailLog', emailLogSchema)
export default EmailLog
