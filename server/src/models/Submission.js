import mongoose from 'mongoose'

const submissionSchema = new mongoose.Schema({
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  originalName: { type: String, required: true, trim: true, maxlength: 255 },
  storedName: { type: String, required: true, unique: true },
  mimeType: { type: String, required: true, enum: ['application/pdf', 'application/msword', 'application/vnd.ms-word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'image/jpeg', 'image/png', 'image/webp'] },
  size: { type: Number, required: true, min: 1, max: 100 * 1024 * 1024 },
  status: { type: String, enum: ['submitted', 'late', 'graded', 'returned'], default: 'submitted', index: true },
  submittedAt: { type: Date, default: Date.now },
  score: { type: Number, min: 0, default: null },
  marksAwarded: { type: Number, min: 0, default: null },
  feedback: { type: String, trim: true, maxlength: 5000, default: '' },
  gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  gradedAt: { type: Date, default: null },
  fileHistory: [{ originalName: { type: String, trim: true, maxlength: 255 }, storedName: { type: String, required: true, trim: true, maxlength: 80 }, mimeType: { type: String, default: 'application/pdf', enum: ['application/pdf', 'application/msword', 'application/vnd.ms-word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'image/jpeg', 'image/png', 'image/webp'] }, size: { type: Number, min: 1, max: 100 * 1024 * 1024 }, submittedAt: { type: Date, default: Date.now } }],
  gradeHistory: [{ marksAwarded: { type: Number, min: 0 }, feedback: { type: String, trim: true, maxlength: 5000, default: '' }, gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, gradedAt: { type: Date, required: true } }],
}, { timestamps: true, versionKey: false })

submissionSchema.index({ assignment: 1, student: 1 }, { unique: true })
const Submission = mongoose.models.Submission || mongoose.model('Submission', submissionSchema)
export default Submission
