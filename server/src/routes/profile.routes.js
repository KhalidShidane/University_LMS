import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth.middleware.js'
import asyncHandler from '../middleware/asyncHandler.js'
import { getProfilePhoto, removeProfilePhoto, updateOwnProfile, uploadProfilePhoto } from '../controllers/profile.controller.js'

const router = Router()
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
  fileFilter: (_req, file, done) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Choose a JPEG, PNG, or WebP photo')
      error.status = 400
      return done(error)
    }
    return done(null, true)
  },
})

router.use(requireAuth)
router.get('/:userId/photo', asyncHandler(getProfilePhoto))
router.patch('/', asyncHandler(updateOwnProfile))
router.post('/photo', imageUpload.single('photo'), asyncHandler(uploadProfilePhoto))
router.delete('/photo', asyncHandler(removeProfilePhoto))

export default router
