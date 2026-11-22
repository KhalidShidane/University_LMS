import mongoose from 'mongoose'
import Class from './Class.js'
import { getExistingReferences } from '../services/referenceValidation.service.js'

const questionSchema = new mongoose.Schema({
  prompt: { type: String, alias: 'questionText', required: true, trim: true, maxlength: 2000 },
  questionType: { type: String, enum: ['multiple_choice', 'true_false', 'short_answer'], default: 'multiple_choice', required: true },
  options: { type: [{ type: String, trim: true, maxlength: 500 }], default: [] },
  correctOption: { type: Number, min: 0, default: undefined },
  correctAnswer: { type: mongoose.Schema.Types.Mixed, default: undefined },
  points: { type: Number, alias: 'marks', default: 1, min: 0.5, max: 1000 },
  order: { type: Number, default: 0, min: 0 },
}, { _id: true })

questionSchema.pre('validate', function validateQuestion(next) {
  if (this.questionType === 'multiple_choice') {
    if (this.options.length < 2 || this.options.length > 8) this.invalidate('options', 'Multiple choice questions need 2 to 8 options')
    const answer = this.correctAnswer
    if (Number.isInteger(answer)) this.correctOption = answer
    if (!Number.isInteger(this.correctOption) || this.correctOption < 0 || this.correctOption >= this.options.length) {
      this.invalidate('correctOption', 'Select a valid correct option')
    }
    this.correctAnswer = this.correctOption
  } else if (this.questionType === 'true_false') {
    this.options = ['True', 'False']
    if (typeof this.correctAnswer === 'boolean') this.correctOption = this.correctAnswer ? 0 : 1
    if (![0, 1].includes(this.correctOption)) this.invalidate('correctOption', 'Choose True or False as the correct answer')
    this.correctAnswer = this.correctOption === 0
  } else {
    this.options = []
    this.correctOption = undefined
    this.correctAnswer = undefined
  }
  if (!Number.isFinite(this.points) || this.points <= 0) this.invalidate('points', 'Question marks must be greater than zero')
  next()
})

const quizSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 5000, default: '' },
  instructions: { type: String, trim: true, maxlength: 5000, default: '' },
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', alias: 'classId', required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', alias: 'teacherId', required: true, index: true },
  questions: { type: [questionSchema], validate: [(questions) => questions.length > 0 && questions.length <= 100, 'A quiz needs between 1 and 100 questions'] },
  totalMarks: { type: Number, default: 0, min: 0 },
  durationMinutes: { type: Number, required: true, min: 1, max: 600 },
  availableFrom: { type: Date, alias: 'startDate', default: Date.now },
  dueDate: { type: Date, alias: 'endDate', default: null },
  attemptLimit: { type: Number, default: 1, min: 1, max: 10 },
  status: { type: String, enum: ['draft', 'published', 'closed'], default: 'draft', index: true },
  isPublished: { type: Boolean, default: false, index: true },
  showResults: { type: Boolean, default: false },
}, { timestamps: true, versionKey: false })

quizSchema.pre('validate', async function validateQuiz() {
  if (this.class) await getExistingReferences(Class, [this.class], 'class')
  if (this.isModified('status') || this.isNew) this.isPublished = this.status === 'published'
  else if (this.isModified('isPublished')) this.status = this.isPublished ? 'published' : 'draft'
  else if (this.status === 'draft' && this.isPublished) this.status = 'published'
  if (this.dueDate && this.availableFrom && this.dueDate <= this.availableFrom) {
    this.invalidate('dueDate', 'End date must be later than the start date')
  }
  this.totalMarks = this.questions.reduce((sum, question) => sum + Number(question.points || 0), 0)
})

const Quiz = mongoose.models.Quiz || mongoose.model('Quiz', quizSchema)
export { questionSchema }
export default Quiz
