import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import asyncHandler from '../middleware/asyncHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.middleware.js'
import { auditMutations } from '../middleware/requestSecurity.middleware.js'
import { createNote, deleteNote, getNote, listNotes, noteFacets, reorderNotes, updateNote } from '../controllers/notes.controller.js'

const router = Router()

// Notes autosave frequently, so they get their own per-student limit instead of the shared
// per-IP limit (many students often share one campus IP address).
const notesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 2400,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `note-student:${req.user._id}`,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'Too many note changes in a short time. Your note will save again shortly.' },
})

router.use(requireAuth, requireRole('student'), notesLimiter)
router.get('/', asyncHandler(listNotes))
router.get('/facets', asyncHandler(noteFacets))
router.put('/order', asyncHandler(reorderNotes))
router.post('/', auditMutations, asyncHandler(createNote))
router.get('/:id', asyncHandler(getNote))
// Autosave edits are intentionally not audit-logged: notes are private and saved very often.
router.patch('/:id', asyncHandler(updateNote))
router.delete('/:id', auditMutations, asyncHandler(deleteNote))

export default router
