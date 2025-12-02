export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

// Hardcoded start date - DO NOT change on redeploy
const PRICE_START_DATE = new Date('2025-11-20T00:00:00Z');
const BASE_PRICE = 99;
const WEEKLY_INCREASE_BEFORE_300 = 20;
const WEEKLY_INCREASE_AFTER_300 = 10;
const PRICE_THRESHOLD = 300;

export async function GET() {
  try {
    const creditData = generateCreditData();
    const currentPrice = getCurrentPrice(creditData.weeksSinceStart);

    return NextResponse.json({
      success: true,
      data: creditData.data,
      defaultIndex: creditData.defaultIndex,
      timeUntilNextMonday: calculateTimeUntilNextThursday(),
      currentPrice,
      weeksSinceStart: creditData.weeksSinceStart,
    });
  } catch (error) {
    console.error('error generating price data:', error);
    return NextResponse.json(
      { success: false, error: 'failed to generate price data' },
      { status: 500 }
    );
  }
}

function generateCreditData() {
  const currentDate = new Date();
  const oneYearFromStart = new Date(PRICE_START_DATE);
  oneYearFromStart.setFullYear(oneYearFromStart.getFullYear() + 1);

  const data = [];

  // Calculate weeks between start date and current date
  const weeksSinceStart = Math.max(
    0,
    Math.floor(
      (currentDate.getTime() - PRICE_START_DATE.getTime()) /
        (7 * 24 * 60 * 60 * 1000)
    )
  );

  // Calculate total weeks from start date to one year from start
  const totalWeeks = Math.ceil(
    (oneYearFromStart.getTime() - PRICE_START_DATE.getTime()) /
      (7 * 24 * 60 * 60 * 1000)
  );

  // Generate data from start date to one year from start
  for (let i = 0; i < totalWeeks; i++) {
    const date = new Date(PRICE_START_DATE);
    date.setDate(date.getDate() + i * 7);

    const price = calculatePriceForWeek(i);

    data.push({
      date: date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      price,
      fullDate: date.toISOString(),
    });
  }

  // Set defaultIndex to the current week
  const defaultIndex = Math.max(0, Math.min(weeksSinceStart, data.length - 1));

  return { data, defaultIndex, weeksSinceStart };
}

function calculatePriceForWeek(week: number): number {
  // $99 base + $20/week until $300, then $10/week after
  let price = BASE_PRICE;

  if (week === 0) {
    return price;
  }

  // Calculate how many weeks until we hit $300
  // $99 + $20*x = $300 => x = (300-99)/20 = 10.05 weeks
  const weeksUntilThreshold = Math.ceil(
    (PRICE_THRESHOLD - BASE_PRICE) / WEEKLY_INCREASE_BEFORE_300
  );

  if (week <= weeksUntilThreshold) {
    // Still in the $20/week phase
    price = BASE_PRICE + week * WEEKLY_INCREASE_BEFORE_300;
  } else {
    // Past threshold: $300 + $10/week for remaining weeks
    const weeksAfterThreshold = week - weeksUntilThreshold;
    price = PRICE_THRESHOLD + weeksAfterThreshold * WEEKLY_INCREASE_AFTER_300;
  }

  return price;
}

function getCurrentPrice(weeksSinceStart: number): number {
  return calculatePriceForWeek(weeksSinceStart);
}

function calculateTimeUntilNextThursday(): number {
  const now = new Date();
  const nextThursday = new Date();
  nextThursday.setDate(now.getDate() + ((4 + 7 - now.getDay()) % 7 || 7));
  nextThursday.setHours(0, 0, 0, 0);
  return nextThursday.getTime() - now.getTime();
}
