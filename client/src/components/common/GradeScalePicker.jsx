import { useState } from 'react'
import { X } from 'lucide-react'
import './GradeScalePicker.css'

const storageKey = 'teacher-grade-scale'
export const gradeLevels = [
  { key: 'excellent', label: 'Excellent', tone: 'grade-level-excellent' },
  { key: 'good', label: 'Good', tone: 'grade-level-good' },
  { key: 'bad', label: 'Bad', tone: 'grade-level-bad' },
]
const defaultScale = { excellent: 100, good: 70, bad: 40 }

function loadScale() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (saved && gradeLevels.every(({ key }) => Number.isFinite(Number(saved[key])))) return { ...defaultScale, ...saved }
  } catch { /* ignore invalid saved scale */ }
  return { ...defaultScale }
}

const roundMarks = (value) => Math.round(value * 2) / 2
export const marksFor = (percent, maxMarks) => roundMarks(Math.min(100, Math.max(0, Number(percent) || 0)) / 100 * Number(maxMarks || 0))

/** Returns the rating label that matches a marks value under the saved scale (for display only). */
export function ratingFor(marks, maxMarks) {
  if (marks === '' || marks === null || marks === undefined) return null
  const scale = loadScale()
  return gradeLevels.find(({ key }) => marksFor(scale[key], maxMarks) === Number(marks))?.label || null
}

/**
 * Two-step grading popup: the teacher first confirms the scale (percent of total marks per level),
 * then picks Excellent / Good / Bad. The calculated marks are returned through onPick.
 */
export default function GradeScalePicker({ maxMarks, studentName, onPick, onClose }) {
  const [scale, setScale] = useState(loadScale)
  const [step, setStep] = useState('scale')
  const valid = gradeLevels.every(({ key }) => scale[key] !== '' && Number(scale[key]) >= 0 && Number(scale[key]) <= 100)

  function confirmScale(event) {
    event.preventDefault()
    if (!valid) return
    const clean = Object.fromEntries(gradeLevels.map(({ key }) => [key, Number(scale[key])]))
    localStorage.setItem(storageKey, JSON.stringify(clean)); setScale(clean); setStep('rating')
  }

  return <div className="modal-backdrop grade-picker-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <section className="panel grade-picker" role="dialog" aria-modal="true" aria-labelledby="grade-picker-title">
      <div className="grade-picker-head"><div><span className="section-kicker">{step === 'scale' ? 'STEP 1 · GRADING SCALE' : 'STEP 2 · CHOOSE GRADE'}</span><h2 id="grade-picker-title">{studentName ? `Grade ${studentName}` : 'Grade'}</h2><p>Out of {maxMarks} marks</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={17} /></button></div>
      {step === 'scale' ? <form onSubmit={confirmScale} className="grade-scale-form">
        <p className="grade-picker-hint">Set what each level is worth (percent of total marks). Your scale is remembered for next time.</p>
        {gradeLevels.map(({ key, label, tone }) => <label key={key} className={`grade-scale-row ${tone}`}><b>{label}</b><span><input type="number" min="0" max="100" step="1" required value={scale[key]} onChange={(e) => setScale({ ...scale, [key]: e.target.value })} />%</span><small>= {marksFor(scale[key], maxMarks)} marks</small></label>)}
        <div className="form-actions"><button type="button" className="button-quiet" onClick={onClose}>Cancel</button><button className="button-primary" disabled={!valid}>Continue</button></div>
      </form> : <div className="grade-rating-step">
        <div className="grade-rating-options">{gradeLevels.map(({ key, label, tone }) => <button type="button" key={key} className={`grade-rating-button ${tone}`} onClick={() => onPick({ level: key, label, marks: marksFor(scale[key], maxMarks) })}><b>{label}</b><small>{marksFor(scale[key], maxMarks)} / {maxMarks}</small></button>)}</div>
        <div className="form-actions"><button type="button" className="button-quiet" onClick={() => setStep('scale')}>Change scale</button></div>
      </div>}
    </section>
  </div>
}
