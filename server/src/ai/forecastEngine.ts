// Placeholder for the forecasting engine. The algorithm(s) and runtime are still being decided,
// so routes and services should depend only on this interface. Swap `placeholderEngine` for the
// real implementation in Step 7.

export interface DemandHistoryPoint {
  periodStart: string // YYYY-MM-DD
  unitsSold: number
}

export interface ForecastRequest {
  productId: number
  history: DemandHistoryPoint[]
  horizonPeriods: number
  reorderLevel: number
  quantityOnHand: number
}

export interface ForecastResult {
  productId: number
  modelName: string
  isFallback: boolean
  predictions: { periodStart: string; quantity: number; lower?: number; upper?: number }[]
  metrics?: { mae?: number; mape?: number }
  reason: string
}

export interface ForecastEngine {
  readonly name: string
  forecast(request: ForecastRequest): Promise<ForecastResult>
}

export const FORECAST_ENGINE_PENDING = 'forecast-engine-tbd'

/** Until a model is chosen, every forecast is a reorder-level fallback (SRS 1.4). */
export const placeholderEngine: ForecastEngine = {
  name: FORECAST_ENGINE_PENDING,
  async forecast(request) {
    return {
      productId: request.productId,
      modelName: FORECAST_ENGINE_PENDING,
      isFallback: true,
      predictions: [],
      reason:
        request.quantityOnHand <= request.reorderLevel
          ? 'At or below reorder level (fallback rule).'
          : 'Above reorder level (fallback rule).',
    }
  },
}
