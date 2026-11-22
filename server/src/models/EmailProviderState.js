import mongoose from 'mongoose'

// Single document (key 'global') describing whether the email provider can currently send.
// 'temporarily_blocked' is set when the provider refuses to send for the whole account (e.g. an
// unverified sending domain or testing-mode restriction on Resend) and
// is only cleared by an administrator after a successful test send.
const emailProviderStateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'global' },
  status: { type: String, enum: ['ok', 'temporarily_blocked'], default: 'ok' },
  // Provider that reported the block; a block only applies while that provider is active.
  provider: { type: String, trim: true, maxlength: 30, default: '' },
  since: { type: Date, default: null },
  lastErrorCode: { type: String, trim: true, maxlength: 60, default: '' },
  providerErrorCode: { type: String, trim: true, maxlength: 40, default: '' },
  providerErrorIdentifier: { type: String, trim: true, maxlength: 80, default: '' },
  httpStatus: { type: Number, default: null },
  lastErrorMessage: { type: String, trim: true, maxlength: 300, default: '' },
  lastCheckedAt: { type: Date, default: null },
  resumedAt: { type: Date, default: null },
  resumedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, versionKey: false })

const EmailProviderState = mongoose.models.EmailProviderState || mongoose.model('EmailProviderState', emailProviderStateSchema)
export default EmailProviderState
