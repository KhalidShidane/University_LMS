import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, LoaderCircle, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import { readOfficeText } from './officeTextPreview.js'
import './PrivateFilePreview.css'

export default function PrivateFilePreview({ src, title, mimeType = '' }) {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [slideCount, setSlideCount] = useState(0)
  const [currentSlide, setCurrentSlide] = useState(0)
  const viewerContainerRef = useRef(null)
  const viewerRef = useRef(null)
  const lowerName = (title || '').toLowerCase()
  const isDocx = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx')
  const isPptx = mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || lowerName.endsWith('.pptx')
  const canPreview = mimeType === 'application/pdf' || (mimeType || '').startsWith('image/') || isDocx || isPptx

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url)
  }, [preview?.url])

  useEffect(() => {
    if (!preview?.pptxData || !viewerContainerRef.current) return undefined
    let cancelled = false
    let viewer
    const abortController = new AbortController()

    async function renderPresentation() {
      try {
        const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer')
        if (cancelled) return
        viewer = await PptxViewer.open(preview.pptxData, viewerContainerRef.current, {
          renderMode: 'list',
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          externalMedia: 'block',
          scrollContainer: viewerContainerRef.current.parentElement,
          signal: abortController.signal,
          listOptions: { windowed: true, initialSlides: 2, batchSize: 2 },
          onSlideChange: (index) => setCurrentSlide(index),
          onSlideError: (index, slideError) => {
            if (!cancelled) setError(`Slide ${index + 1} could not be displayed: ${slideError?.message || 'unsupported slide content'}`)
          },
        })
        if (cancelled) {
          viewer.destroy()
          return
        }
        viewerRef.current = viewer
        setSlideCount(viewer.slideCount)
        setCurrentSlide(viewer.currentSlideIndex || 0)
      } catch (renderError) {
        if (cancelled) return
        try {
          const office = await readOfficeText(new Blob([preview.pptxData], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }))
          if (cancelled) return
          setPreview({ office, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
          setError('Slide design could not be displayed. Showing the lesson text instead.')
        } catch (textError) {
          const reason = textError instanceof Error ? textError.message : renderError instanceof Error ? renderError.message : 'Unsupported PowerPoint file'
          setError(`Could not open this PowerPoint: ${reason}`)
        }
      }
    }

    renderPresentation()
    return () => {
      cancelled = true
      abortController.abort()
      viewer?.destroy()
      if (viewerRef.current === viewer) viewerRef.current = null
    }
  }, [preview?.pptxData])

  async function togglePreview() {
    if (preview) { setPreview(null); setError(''); return }
    setLoading(true); setError('')
    try {
      const { data } = await api.get(src, { responseType: 'blob' })
      const contentType = data.type || mimeType
      if (isPptx) {
        setPreview({ pptxData: await data.arrayBuffer(), mimeType: contentType })
      } else if (isDocx) {
        const office = await readOfficeText(data)
        setPreview({ office, mimeType: contentType })
      } else {
        if (contentType !== 'application/pdf' && !(contentType || '').startsWith('image/')) throw new Error('This file type cannot be previewed in the browser')
        setPreview({ url: URL.createObjectURL(data), mimeType: contentType })
      }
    } catch (requestError) {
      const message = requestError.response?.data instanceof Blob ? 'Could not open this preview. Download the file to read it.' : apiErrorMessage(requestError)
      setError(message); toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  async function changeSlide(direction) {
    const viewer = viewerRef.current
    if (!viewer) return
    const nextSlide = currentSlide + direction
    if (nextSlide < 0 || nextSlide >= slideCount) return
    try {
      await viewer.goToSlide(nextSlide, { behavior: 'smooth', block: 'nearest' })
      setCurrentSlide(nextSlide)
    } catch {
      setError('Could not display this PowerPoint slide.')
    }
  }

  if (!canPreview) return null
  return <div className={`private-file-preview ${preview ? 'private-preview-open' : ''}`}>
    <button type="button" className="button-secondary private-preview-toggle" onClick={togglePreview} aria-expanded={Boolean(preview)}>
      {loading ? <LoaderCircle className="spin" size={14} /> : <BookOpen size={14} />}
      {loading ? 'Opening…' : preview ? 'Close reader' : isPptx ? 'Read Here' : isDocx ? 'Read document' : 'Read here'}
    </button>
    {error && <span className="private-preview-error" role="status">{error}</span>}
    {preview && <section className="private-preview-panel" aria-label={`${title} preview`}>
      <div className="private-preview-toolbar"><b title={title}>{title}</b><button type="button" className="icon-button" onClick={togglePreview} aria-label="Close reader"><X size={16} /></button></div>
      {preview.pptxData ? <div className="private-pptx-viewer">
        <div ref={viewerContainerRef} className="private-pptx-slides" aria-label="PowerPoint slides" />
        <div className="private-pptx-controls">
          <button type="button" className="icon-button" onClick={() => changeSlide(-1)} disabled={currentSlide <= 0} aria-label="Previous slide"><ArrowLeft size={16} /></button>
          <span>{slideCount ? `${currentSlide + 1} / ${slideCount}` : 'Loading slides…'}</span>
          <button type="button" className="icon-button" onClick={() => changeSlide(1)} disabled={!slideCount || currentSlide >= slideCount - 1} aria-label="Next slide"><ArrowRight size={16} /></button>
        </div>
      </div> : preview.office?.format === 'docx' ? <article className="private-office-document" aria-label="Word document text">{preview.office.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</article> : preview.office?.format === 'pptx' ? <div className="private-office-slides" aria-label="PowerPoint slide text">{preview.office.slides.map((slide) => <article className="private-office-slide" key={slide.number}><small>SLIDE {slide.number}</small>{slide.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</article>)}</div> : preview.mimeType === 'application/pdf' ? <iframe className="private-pdf-frame" src={preview.url} title={`Read ${title}`} /> : <div className="private-image-frame"><img src={preview.url} alt={title} /></div>}
    </section>}
  </div>
}
