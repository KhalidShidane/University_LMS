import mongoose from 'mongoose'

export const noteColors = ['default', 'yellow', 'green', 'blue', 'purple', 'pink', 'orange']
export const emptyNoteDocument = () => ({ type: 'doc', content: [{ type: 'paragraph' }] })

// Personal study notes. A note always belongs to exactly one student and may optionally be
// linked to a course and/or a lesson the student can access. `content` stores the rich-text
// document as structured JSON (TipTap/ProseMirror format); `contentText` is a plain-text copy
// used for search and previews.
const noteSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
  lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', default: null },
  title: { type: String, trim: true, maxlength: 200, default: '' },
  content: { type: mongoose.Schema.Types.Mixed, default: emptyNoteDocument },
  contentText: { type: String, default: '' },
  wordCount: { type: Number, default: 0, min: 0 },
  color: { type: String, enum: noteColors, default: 'default' },
  tags: { type: [{ type: String, trim: true, lowercase: true, maxlength: 40 }], default: [] },
  order: { type: Number, default: 0 },
  // Incremented on every content/metadata save; autosave sends the version it edited so the
  // server can refuse to overwrite newer content with an outdated copy.
  version: { type: Number, default: 1, min: 1 },
}, { timestamps: true, versionKey: false, minimize: false })

noteSchema.index({ student: 1, order: 1, updatedAt: -1 })
noteSchema.index({ student: 1, course: 1, lesson: 1 })
noteSchema.index({ student: 1, updatedAt: -1 })
noteSchema.index({ student: 1, tags: 1 })

const Note = mongoose.models.Note || mongoose.model('Note', noteSchema)
export default Note
