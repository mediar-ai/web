'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveContainer, BarChart, Bar, Cell, Tooltip } from 'recharts';
import { Loader2 } from 'lucide-react';

interface PriceData {
  date: string;
  price: number;
  fullDate: string;
}

interface PricingSectionProps {
  onPriceLoaded?: (price: number) => void;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const { date, price } = payload[0].payload;
    return (
      <div className="bg-white text-black p-2 border-2 border-black font-mono text-sm">
        <p>{date}</p>
        <p className="font-bold">${price}</p>
      </div>
    );
  }
  return null;
};

export default function PricingSection({ onPriceLoaded }: PricingSectionProps) {
  const [priceData, setPriceData] = useState<PriceData[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [timeUntilNextMonday, setTimeUntilNextMonday] = useState(0);
  const [loading, setLoading] = useState(true);

  // Fetch price data
  useEffect(() => {
    const fetchPriceData = async () => {
      try {
        const response = await fetch('/api/price-generation');
        if (!response.ok) throw new Error('failed to fetch price data');

        const result = await response.json();
        if (result.success) {
          setPriceData(result.data);
          setActiveIndex(result.defaultIndex);
          setTimeUntilNextMonday(result.timeUntilNextMonday);
          onPriceLoaded?.(result.currentPrice);
        }
      } catch (error) {
        console.error('error fetching price data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPriceData();
  }, [onPriceLoaded]);

  // Update countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeUntilNextMonday(prev => Math.max(0, prev - 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleBarClick = (_: any, index: number) => {
    setActiveIndex(index);
  };

  const formatTime = (milliseconds: number) => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { days, hours, minutes, seconds };
  };

  const { days, hours, minutes, seconds } = formatTime(timeUntilNextMonday);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 relative">
      {/* Price increase countdown */}
      <Card className="border-2 border-black">
        <CardContent className="p-6">
          <h3 className="text-xl font-bold font-mono text-center mb-4">
            TIME UNTIL NEXT PRICE INCREASE
          </h3>
          <div className="flex justify-center items-center gap-4 text-center">
            <div className="flex flex-col">
              <span className="text-4xl font-bold font-mono">{days}</span>
              <span className="text-xs text-gray-600 uppercase">Days</span>
            </div>
            <span className="text-4xl font-bold">:</span>
            <div className="flex flex-col">
              <span className="text-4xl font-bold font-mono">
                {String(hours).padStart(2, '0')}
              </span>
              <span className="text-xs text-gray-600 uppercase">Hours</span>
            </div>
            <span className="text-4xl font-bold">:</span>
            <div className="flex flex-col">
              <span className="text-4xl font-bold font-mono">
                {String(minutes).padStart(2, '0')}
              </span>
              <span className="text-xs text-gray-600 uppercase">Min</span>
            </div>
            <span className="text-4xl font-bold">:</span>
            <div className="flex flex-col">
              <span className="text-4xl font-bold font-mono">
                {String(seconds).padStart(2, '0')}
              </span>
              <span className="text-xs text-gray-600 uppercase">Sec</span>
            </div>
          </div>
          <p className="text-center text-sm text-gray-600 mt-4 font-mono">
            Price increases every Monday
          </p>
        </CardContent>
      </Card>

      {/* Price history chart */}
      <Card className="border-2 border-black">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-sm uppercase text-gray-600">
            Minimum Credit Balance Top Up
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div style={{ width: '100%', height: '200px' }}>
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={priceData}>
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="price" onClick={handleBarClick}>
                    {priceData.map((_, index) => (
                      <Cell
                        cursor="pointer"
                        fill={index === activeIndex ? '#000000' : '#E5E5E5'}
                        key={`cell-${index}`}
                        stroke="none"
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
