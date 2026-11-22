import mongoose from 'mongoose'

const answerSchema = new mongoose.Schema({
  question: { type: mongoose.Schema.Types.ObjectId, required: true },
  selectedOption: { type: Number, min: 0, default: undefined },
  textAnswer: { type: String, maxlength: 10000, default: '' },
  marksAwarded: { type: Number, min: 0, default: null },
  feedback: { type: String, trim: true, maxlength: 3000, default: '' },
}, { _id: false })

const quizAttemptSchema = new mongoose.Schema({
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', alias: 'quizId', required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', alias: 'studentId', required: true, index: true },
  startedAt: { type: Date, required: true, default: Date.now },
  endsAt: { type: Date, alias: 'expiresAt', required: true },
  submittedAt: { type: Date, default: null },
  answers: { type: [answerSchema], default: [] },
  score: { type: Number, default: null, min: 0 },
  maxScore: { type: Number, required: true, min: 0.5 },
  status: { type: String, enum: ['in_progress', 'submitted', 'auto_submitted', 'graded', 'in-progress', 'expired'], default: 'in_progress', index: true },
  activeKey: { type: String, select: false },
  gradedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false })

quizAttemptSchema.index({ quiz: 1, student: 1, submittedAt: 1 })
quizAttemptSchema.index({ activeKey: 1 }, { unique: true, sparse: true })
const QuizAttempt = mongoose.models.QuizAttempt || mongoose.model('QuizAttempt', quizAttemptSchema)
export { answerSchema }
export default QuizAttempt
