import mongoose from 'mongoose'
import Class from './Class.js'
import Department from './Department.js'
import { getExistingDocuments, getExistingReferences } from '../services/referenceValidation.service.js'

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true, maxlength: 160 },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 254,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email must be a valid email address'],
  },
  passwordHash: {
    type: String,
    required: true,
    select: false,
    validate: {
      validator: (value) => BCRYPT_HASH_PATTERN.test(value),
      message: 'passwordHash must be a bcrypt hash; plain-text passwords are not accepted',
    },
  },
  role: { type: String, required: true, enum: ['admin', 'teacher', 'student'], index: true },
  studentId: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 40,
    required() { return this.role === 'student' },
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required() { return this.role === 'teacher' && this.assignedClasses?.length > 0 },
    index: true,
  },
  departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  assignedClasses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
  class: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required() { return this.role === 'student' },
    index: true,
  },
  profileImage: { type: String, trim: true, maxlength: 2048, default: '' },
  isActive: { type: Boolean, default: true, index: true },
  sessionVersion: { type: Number, default: 0, min: 0, select: false },
  // Email verification. Self-registered students start with false; legacy accounts are migrated to true.
  emailVerified: { type: Boolean, index: true },
  emailVerifiedAt: { type: Date, default: null },
  emailVerificationLegacy: { type: Boolean, default: undefined },
  emailVerificationTokenHash: { type: String, select: false, default: undefined },
  emailVerification: {
    expiresAt: { type: Date },
    lastSentAt: { type: Date },
    windowStartedAt: { type: Date },
    sendCount: { type: Number, min: 0 },
    deliveryStatus: { type: String, enum: ['pending', 'sent', 'failed'] },
    deliveryError: { type: String, maxlength: 60 },
  },
  // Password reset: only a hash of the single-use token is stored.
  passwordResetTokenHash: { type: String, select: false, default: undefined },
  passwordReset: {
    expiresAt: { type: Date },
    requestedAt: { type: Date },
  },
  // Two-step verification (TOTP). Secrets are AES-256-GCM encrypted; recovery codes are hashes.
  twoFactor: {
    enabled: { type: Boolean },
    secret: { type: String, select: false },
    pendingSecret: { type: String, select: false },
    recoveryCodes: { type: [String], select: false, default: undefined },
    lastUsedStep: { type: Number },
    enabledAt: { type: Date },
  },
  // Password-guessing protection: consecutive failures and a temporary lock.
  loginLock: {
    failures: { type: Number, min: 0 },
    lastFailedAt: { type: Date },
    until: { type: Date },
  },
  // Per-user interface settings (e.g. dark mode applies only to this user's own dashboard).
  uiPreferences: {
    theme: { type: String, enum: ['light', 'dark'], default: undefined },
  },
  // Optional email notifications (missing = enabled). Account/security emails are always sent.
  notificationPreferences: {
    email: {
      quizzes: { type: Boolean },
      assignments: { type: Boolean },
      lessons: { type: Boolean },
      materials: { type: Boolean },
      announcements: { type: Boolean },
      reminders: { type: Boolean },
    },
  },
}, {
  timestamps: true,
  versionKey: false,
  toJSON: { transform(_document, record) { delete record.passwordHash; delete record.emailVerificationTokenHash; delete record.passwordResetTokenHash; return record } },
})

userSchema.index(
  { studentId: 1 },
  { unique: true, partialFilterExpression: { studentId: { $type: 'string' } } },
)
userSchema.index(
  { passwordResetTokenHash: 1 },
  { unique: true, partialFilterExpression: { passwordResetTokenHash: { $type: 'string' } } },
)
userSchema.index(
  { emailVerificationTokenHash: 1 },
  { unique: true, partialFilterExpression: { emailVerificationTokenHash: { $type: 'string' } } },
)
userSchema.path('assignedClasses').validate(
  (classIds) => new Set(classIds.map(String)).size === classIds.length,
  'Teacher class assignments cannot contain duplicates',
)

userSchema.pre('validate', async function validateUserReferences() {
  if (this.role !== 'student' && this.studentId) {
    this.invalidate('studentId', 'Only student accounts can have a Student ID')
  }
  if (this.role !== 'student' && this.class) {
    this.invalidate('class', 'Only student accounts can be assigned a student class')
  }
  if (this.department) {
    await getExistingReferences(Department, [this.department], 'department')
  }
  const departmentIds = [...new Set([...(this.departments || []).map(String), ...(this.department ? [String(this.department)] : [])])]
  if (this.departments?.length && new Set(this.departments.map(String)).size !== this.departments.length) {
    this.invalidate('departments', 'Teacher departments cannot contain duplicates')
  }
  if (this.departments?.length) await getExistingReferences(Department, this.departments, 'departments')

  const classIds = [...this.assignedClasses]
  if (this.class) classIds.push(this.class)
  if (!classIds.length) return

  const classDocuments = await getExistingDocuments(Class, classIds, '_id department', 'class')
  if (this.role === 'teacher' && departmentIds.length) {
    if (classDocuments.some((record) => !departmentIds.includes(String(record.department)))) {
      this.invalidate('assignedClasses', 'Teacher classes must belong to an assigned department')
    }
  }
  if (this.role === 'student' && this.class && this.department) {
    const studentClass = classDocuments.find((record) => String(record._id) === String(this.class))
    if (studentClass && String(studentClass.department) !== String(this.department)) {
      this.invalidate('department', 'Student department must match the selected class')
    }
  }
})

const User = mongoose.models.User || mongoose.model('User', userSchema)
export { userSchema }
export default User
