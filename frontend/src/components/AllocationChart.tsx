import React, { useEffect, useState } from 'react';
import { getPortfolioSummary } from '../services/api';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatPercentage, toDecimal } from '../utils/decimalHelper';

interface AllocationChartProps {
  walletId?: number;
}

const COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#06B6D4',
];

interface ChartRow {
  name: string;
  value: number;
  percentage: string;
  color: string;
}

const AllocationChart: React.FC<AllocationChartProps> = ({ walletId }) => {
  const [data, setData] = useState<ChartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const summary = await getPortfolioSummary(walletId);

      const chartData = summary.assets
        .filter((d) => toDecimal(d.allocation_pct).greaterThan(0))
        .map((d, index) => ({
          name: d.symbol.toUpperCase(),
          value: Number(toDecimal(d.allocation_pct).toString()),
          percentage: formatPercentage(d.allocation_pct),
          color: COLORS[index % COLORS.length],
        }));

      setData(chartData);
      setError(null);
    } catch (err) {
      console.error('Error fetching allocation data:', err);
      setError('Error al cargar los datos de asignación');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [walletId]);

  if (loading) {
    return <div className="w-full h-64 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse"></div>;
  }

  if (error) {
    return (
      <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 p-4 rounded-xl">
        {error}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="w-full h-64 bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-300 dark:border-gray-600 rounded-xl flex items-center justify-center text-gray-500 dark:text-gray-400">
        <p className="text-center">No hay datos de asignación</p>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartRow }> }) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
          <p className="font-medium text-gray-900 dark:text-white">{item.name}</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">{item.percentage} del portafolio</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
        Distribución del Portafolio
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            outerRadius={90}
            fill="#8884d8"
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            layout="vertical"
            verticalAlign="middle"
            align="right"
            formatter={(value, entry) => {
              const percentage = (entry.payload as ChartRow | undefined)?.percentage ?? '';
              return `${value} (${percentage})`;
            }}
            wrapperStyle={{
              fontSize: '12px',
              color: '#6B7280',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AllocationChart;
