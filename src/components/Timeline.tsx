import { useEffect, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import { dateLabel, monthKey } from '../lib/market'

export default function Timeline({
  dates,
  date,
  onChange,
}: {
  dates: string[]
  date: string
  onChange: (date: string) => void
}) {
  const [playing, setPlaying] = useState(false)
  const index = Math.max(0, dates.indexOf(date))
  useEffect(() => {
    if (!playing || dates.length < 2) return
    const timer = setInterval(() => onChange(dates[(index + 1) % dates.length]), 1500)
    return () => clearInterval(timer)
  }, [playing, index, dates, onChange])
  function jump(next: number) {
    setPlaying(false)
    onChange(dates[next])
  }
  return (
    <div className="timeline" aria-label="Reporting timeline">
      <div className="timeline-date">
        <CalendarDays size={17} />
        <span>
          <small>REPORTING THROUGH</small>
          <strong>{dateLabel(date)}</strong>
        </span>
      </div>
      <div className="timeline-player">
        <button
          aria-label={playing ? 'Pause timeline' : 'Play timeline'}
          onClick={() => setPlaying(!playing)}
          disabled={dates.length < 2}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button
          aria-label="Previous reporting month"
          disabled={index === 0}
          onClick={() => jump(index - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <input
          aria-label="Reporting month"
          type="range"
          min={0}
          max={Math.max(0, dates.length - 1)}
          value={index}
          onChange={(e) => jump(Number(e.target.value))}
          aria-valuetext={dateLabel(date, 'long')}
        />
        <button
          aria-label="Next reporting month"
          disabled={index === dates.length - 1}
          onClick={() => jump(index + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="timeline-window">
        <span>
          {dateLabel(`${monthKey(date, -2)}-01`)} - {dateLabel(date)}
        </span>
        <small>Three-month sales window</small>
      </div>
      <button
        className="timeline-latest"
        disabled={index === dates.length - 1}
        onClick={() => jump(dates.length - 1)}
      >
        <RotateCcw size={12} />
        Latest
      </button>
    </div>
  )
}
