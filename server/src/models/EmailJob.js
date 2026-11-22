import mongoose from 'mongoose'

// Durable background email queue. One document per (event, recipient); dedupeKey makes
// enqueueing idempotent so retries, double clicks, or restarts never send twice.
const emailJobSchema = new mongoose.Schema({
  template: { type: String, required: true, trim: true, maxlength: 60, index: true },
  // Preference category the student can switch off (null for mandatory messages).
  category: { type: String, trim: true, maxlength: 40, default: null },
  priority: { type: Number, default: 5, min: 0, max: 9 },
  recipientUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipientEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  recipientName: { type: String, trim: true, maxlength: 160, default: '' },
  dedupeKey: { type: String, required: true, trim: true, maxlength: 300 },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Optional send-time check (deadline reminders are cancelled if no longer valid).
  check: {
    kind: { type: String, trim: true, maxlength: 40 },
    itemId: { type: mongoose.Schema.Types.ObjectId },
    dueDate: { type: Date },
  },
  status: { type: String, enum: ['pending', 'sending', 'sent', 'failed', 'cancelled', 'expired'], default: 'pending', index: true },
  attempts: { type: Number, default: 0, min: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lockedUntil: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
  sentAt: { type: Date, default: null },
  providerMessageId: { type: String, trim: true, maxlength: 120, default: '' },
  lastErrorCode: { type: String, trim: true, maxlength: 60, default: '' },
  cancelReason: { type: String, trim: true, maxlength: 80, default: '' },
}, { timestamps: true, versionKey: false })

emailJobSchema.index({ dedupeKey: 1 }, { unique: true })
emailJobSchema.index({ status: 1, priority: 1, nextAttemptAt: 1 })
emailJobSchema.index({ status: 1, lockedUntil: 1 })

const EmailJob = mongoose.models.EmailJob || mongoose.model('EmailJob', emailJobSchema)
export default EmailJob
