import { ArrowRight, ArrowUpRight, X } from 'lucide-react'
import type { RefObject } from 'react'
import type { Dataset } from '../types'
import { dateLabel } from '../lib/market'

export default function Methodology({
  dialog,
  dataset,
  date,
  minimumSales,
}: {
  dialog: RefObject<HTMLDialogElement | null>
  dataset: Dataset
  date: string
  minimumSales: number
}) {
  return (
    <dialog ref={dialog} className="methodology-dialog">
      <div className="dialog-top">
        <span className="eyebrow">TRANSPARENT BY DESIGN</span>
        <button aria-label="Close data information" onClick={() => dialog.current?.close()}>
          <X size={20} />
        </button>
      </div>
      <h2>A little context goes a long way.</h2>
      <p>
        These are monthly area-level summaries. They are not individual property records, and sparse
        neighborhoods are not filled in with estimates.
      </p>
      <div className="methodology-grid">
        <article>
          <h3>Sale prices, not appraisals</h3>
          <p>
            Changes compare median prices of different homes sold in two rolling three-month
            windows. They reflect transaction mix as well as market movement. Price per square foot
            is also mix-sensitive. We never average neighborhood medians into a city price.
          </p>
        </article>
        <article>
          <h3>Three distinct source categories</h3>
          <p>
            We preserve Redfin’s Single Family Residential, Condo/Co-op, and Townhouse groups.
            “Condos” includes co-ops. Aggregate data cannot resolve townhouse-style condominiums or
            reclassify individual homes.
          </p>
        </article>
        <article>
          <h3>Sample size, not a confidence score</h3>
          <p>
            The current filter requires {minimumSales} sales in each price-comparison window. The 5,
            10, and 20-sale settings are screening rules, not statistical confidence intervals. City
            statistics use the provider’s city series rather than a sum of potentially overlapping
            neighborhoods.
          </p>
        </article>
        <article>
          <h3>Annual volume without double counting</h3>
          <p>
            Annual sales use four adjacent, non-overlapping three-month windows. Adding all twelve
            monthly rows would count overlapping periods repeatedly. All four counts must be present
            to display an annual total. A missing quarter is not zero; repeated sales are not unique
            properties.
          </p>
        </article>
        <article>
          <h3>Reading the summary statistics</h3>
          <p>
            Cards show the unweighted median of eligible area changes. “Same areas for all types”
            restricts those cards to a shared eligible set. Market breadth counts rising, flat
            (within 0.05%), and falling areas; the middle 50% is the interquartile range of area
            changes, not home prices or uncertainty.
          </p>
        </article>
        <article>
          <h3>Map locations have limits</h3>
          <p>
            City centers are approximate. Neighborhood points are uniquely name-matched to Zillow’s
            2017 reference dataset and are not Redfin boundaries. Map-view filtering excludes
            locations without coordinates. The OpenFreeMap basemap does not create additional price
            or parcel data.
          </p>
        </article>
        <article>
          <h3>A consistent time window</h3>
          <p>
            Viewing {dateLabel(date, 'long')}. Latest snapshot: {dateLabel(dataset.dataThrough)}.
            Source updated {dataset.sourceUpdatedAt.slice(0, 10)}; imported{' '}
            {dataset.generatedAt.slice(0, 10)}. Everything uses the same release. Historical values
            may change on refresh. Shorter comparisons are not seasonally adjusted or annualized.
          </p>
        </article>
        <article>
          <h3>Benchmark and activity charts</h3>
          <p>
            City-relative gaps are percentage-point differences between matching price-change
            measures. Sales and inventory charts show reported three-month-window values; their
            adjacent points overlap. Price and median-days charts screen low-sales points, while raw
            count charts preserve reported zero values.
          </p>
        </article>
      </div>
      <div className="source-links">
        <a
          href="https://www.redfin.com/news/data-center/methodology/"
          target="_blank"
          rel="noreferrer"
        >
          Redfin methodology <ArrowUpRight size={14} />
        </a>
        <a
          href="https://www.redfin.com/news/data-center/downloads/"
          target="_blank"
          rel="noreferrer"
        >
          Redfin downloads <ArrowUpRight size={14} />
        </a>
        <a
          href="https://www.arcgis.com/home/item.html?id=56b89613f9f7450fb44e857691a244e7"
          target="_blank"
          rel="noreferrer"
        >
          Reference locations: Zillow / EPA <ArrowUpRight size={14} />
        </a>
      </div>
      <button className="primary-button" onClick={() => dialog.current?.close()}>
        Back to exploring <ArrowRight size={15} />
      </button>
    </dialog>
  )
}
