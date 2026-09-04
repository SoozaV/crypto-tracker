import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { createChart, LineStyle, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { getAssetDetail, getOhlcv } from '../services/api';
import type { AssetDetail as AssetDetailType, OhlcvCandle } from '../types';
import { formatCurrency, formatQuantity, formatPercentage, getSign, toDecimal } from '../utils/decimalHelper';

interface AssetDetailProps {
  walletId?: number;
}

interface DetailWithCandles extends AssetDetailType {
  candles: OhlcvCandle[];
}

const AssetDetail: React.FC<AssetDetailProps> = ({ walletId }) => {
  const { assetId } = useParams<{ assetId: string }>();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<DetailWithCandles | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assetId) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        const [det, ohlcv] = await Promise.all([
          getAssetDetail(Number(assetId), walletId),
          getOhlcv(Number(assetId), days),
        ]);
        setDetail({ ...det, candles: ohlcv.candles });
        setError(null);
      } catch (err) {
        console.error('Error fetching asset detail:', err);
        setError('Error al cargar los datos del activo');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [assetId, walletId, days]);

  useEffect(() => {
    if (!chartContainerRef.current || !detail?.candles?.length) return;

    const container = chartContainerRef.current;
    container.innerHTML = '';

    const chart: IChartApi = createChart(container, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#6B7280',
      },
      grid: {
        vertLines: { color: '#E5E7EB' },
        horzLines: { color: '#E5E7EB' },
      },
      width: container.clientWidth,
      height: 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    const candleData = detail.candles.map((c) => ({
      time: Math.floor(new Date(c.timestamp).getTime() / 1000) as UTCTimestamp,
      open: Number(toDecimal(c.open).toString()),
      high: Number(toDecimal(c.high).toString()),
      low: Number(toDecimal(c.low).toString()),
      close: Number(toDecimal(c.close).toString()),
    }));
    candleSeries.setData(candleData);

    if (detail.avg_price && !toDecimal(detail.avg_price).isZero()) {
      const avgPrice = Number(toDecimal(detail.avg_price).toString());
      const avgLineSeries = chart.addLineSeries({
        color: '#F59E0B',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: true,
        priceLineColor: '#F59E0B',
        priceLineWidth: 2,
        title: 'Tu Precio Prom.',
      });
      avgLineSeries.setData(candleData.map((d) => ({ time: d.time, value: avgPrice })));
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [detail]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
        <div className="h-96 bg-gray-200 dark:bg-gray-700 rounded"></div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 p-4 rounded-xl">
        {error || 'Activo no encontrado'}
      </div>
    );
  }

  const pnlSign = getSign(detail.unrealized_pnl);
  const changeClass = (value: string | null | undefined) => {
    const sign = getSign(value);
    if (sign === 'zero') return 'text-gray-500';
    return sign === 'positive' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  };

  return (
    <div>
      <Link to="/" className="text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block">
        ← Volver al portafolio
      </Link>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              {detail.symbol.toUpperCase()}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Cantidad: {formatQuantity(detail.quantity, detail.decimals ?? 8)} |{' '}
              Promedio: {formatCurrency(detail.avg_price)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              {detail.price_now != null ? formatCurrency(detail.price_now) : '—'}
            </p>
            <p
              className={`text-sm font-medium ${
                pnlSign === 'positive'
                  ? 'text-green-600'
                  : pnlSign === 'negative'
                    ? 'text-red-600'
                    : 'text-gray-500'
              }`}
            >
              {formatCurrency(detail.unrealized_pnl)} ({formatPercentage(detail.roi_pct)})
            </p>
          </div>
        </div>

        {detail.changes && (
          <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">24h</p>
              <p className={`text-sm font-mono font-medium ${changeClass(detail.changes.change_24h_pct)}`}>
                {formatPercentage(detail.changes.change_24h_pct)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">7d</p>
              <p className={`text-sm font-mono font-medium ${changeClass(detail.changes.change_7d_pct)}`}>
                {formatPercentage(detail.changes.change_7d_pct)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">30d</p>
              <p className={`text-sm font-mono font-medium ${changeClass(detail.changes.change_30d_pct)}`}>
                {formatPercentage(detail.changes.change_30d_pct)}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Histórico (OHLCV)
          </h3>
          <div className="flex gap-2">
            {[7, 30, 90, 365].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 text-xs rounded transition ${
                  days === d
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <div ref={chartContainerRef} className="w-full h-[400px]" />
      </div>
    </div>
  );
};

export default AssetDetail;
