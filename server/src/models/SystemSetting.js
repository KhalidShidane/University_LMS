import mongoose from 'mongoose'
import { courseSemesters } from '../config/academicSemesters.js'

const gradingScaleSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 20 },
  min: { type: Number, required: true, min: 0, max: 100 },
  max: { type: Number, required: true, min: 0, max: 100 },
}, { _id: false, id: false, strict: 'throw' })

const systemSettingSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true, immutable: true },
  general: {
    institutionName: { type: String, default: 'University LMS', trim: true, maxlength: 160 },
    logo: { type: String, default: '', trim: true, maxlength: 2048 },
    contactEmail: { type: String, default: '', trim: true, maxlength: 254 },
    phone: { type: String, default: '', trim: true, maxlength: 40 },
    address: { type: String, default: '', trim: true, maxlength: 500 },
    timezone: { type: String, default: 'Africa/Nairobi', trim: true, maxlength: 80 },
    dateFormat: { type: String, enum: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'], default: 'DD/MM/YYYY' },
    timeFormat: { type: String, enum: ['12h', '24h'], default: '24h' },
  },
  academic: {
    academicYear: { type: String, default: '', trim: true, maxlength: 20 },
    semester: { type: String, default: '', trim: true, maxlength: 80 },
    semesters: { type: [String], default: courseSemesters, validate: [(items) => items.length > 0 && items.length <= 30, 'Configure between 1 and 30 semesters'] },
    gradingScale: { type: [gradingScaleSchema], default: [{ label: 'A', min: 80, max: 100 }, { label: 'B', min: 70, max: 79.99 }, { label: 'C', min: 60, max: 69.99 }, { label: 'D', min: 50, max: 59.99 }, { label: 'F', min: 0, max: 49.99 }] },
    passingMarks: { type: Number, default: 50, min: 0, max: 100 },
  },
  uploads: {
    maxFileSizeMB: { type: Number, default: 10, min: 1, max: 10 },
    assignmentTypes: { type: [String], default: ['pdf', 'doc', 'docx', 'ppt', 'pptx'] },
    learningMaterialTypes: { type: [String], default: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'webp'] },
    profileImageTypes: { type: [String], default: ['jpg', 'jpeg', 'png', 'webp'] },
  },
}, { timestamps: true, versionKey: false, strict: 'throw' })

export default mongoose.models.SystemSetting || mongoose.model('SystemSetting', systemSettingSchema)
