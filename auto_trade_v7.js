const axios = require('axios');
const fs = require('fs');
require('dotenv').config();
const moment = require('moment-timezone');
const { RSI, MACD, BollingerBands } = require('technicalindicators');

// const ALPACA_API_KEY = process.env.ALPACA_API_KEY_V6;
// const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY_V6;
const ALPACA_API_KEY = 'PKSAA8VSBWM3HJSHXOLX';
const ALPACA_SECRET_KEY = 'U4oMJsLouil9YHUa7E65bgXb9U4F2IiS9UmMe63s';


const PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_BASE_URL = 'https://data.alpaca.markets/v2/stocks';
const PREDICTION_LOG_FILE = 'predictions_log.json';
const QUANTITY_MIN = 25;
const QUANTITY_MAX = 100;

const stockSymbols = ['NIO', 'FUBO', 'OPEN', 'SPCE', 'NKLA', 'BB', 'AMC', 'IQ', 'STNE', 'PAGS'];

// Fetch intraday stock data
async function fetchIntradayData(symbol, startDate, requiredDataPoints) {
    const endpoint = `${DATA_BASE_URL}/${symbol}/bars`;
    const barsToFetch = requiredDataPoints * 2; // Fetch extra data to ensure sufficient points
    try {
        const response = await axios.get(endpoint, {
            headers: {
                'APCA-API-KEY-ID': ALPACA_API_KEY,
                'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
            },
            params: {
                start: startDate,
                timeframe: '15Min',
                limit: barsToFetch,
            },
        });

        const bars = response.data.bars;
        if (bars.length < requiredDataPoints) {
            console.warn(`Not enough data fetched for ${symbol}. Only ${bars.length} bars retrieved.`);
            return [];
        }

        // Trim the data to exactly the required number of points
        return bars.slice(-requiredDataPoints).map(bar => ({
            symbol,
            time: bar.t,
            close: bar.c,
            high: bar.h,
            low: bar.l,
            open: bar.o,
        }));
    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error.message);
        return [];
    }
}

// Calculate technical indicators
function calculateIndicators(data) {
    const closes = data.map(d => d.close);

    // Ensure we only calculate if there are enough data points
    const sufficientData = closes.length >= 35;

    if (!sufficientData) {
        return { rsi: [], macd: [], bb: [] };
    }

    // RSI
    const rsi = RSI.calculate({ values: closes, period: 14 });

    // MACD
    const macd = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
    });

    // Bollinger Bands
    const bb = BollingerBands.calculate({
        period: 20,
        values: closes,
        stdDev: 2,
    });

    return { rsi, macd, bb };
}

// Generate trading signal
function generateSignal(indicators, latestClose) {
    const { rsi, macd, bb } = indicators;

    const latestRSI = rsi.length > 0 ? rsi[rsi.length - 1] : null;
    const latestMACD = macd.length > 0 ? macd[macd.length - 1] : null;
    const latestBB = bb.length > 0 ? bb[bb.length - 1] : null;

    let signal = "Hold";

    // RSI-based signal
    if (latestRSI !== null) {
        if (latestRSI < 30) signal = "Buy"; // Oversold
        if (latestRSI > 70) signal = "Sell"; // Overbought
    }

    // MACD-based confirmation
    if (latestMACD && latestMACD.histogram > 0 && signal === "Buy") signal = "Buy";
    if (latestMACD && latestMACD.histogram < 0 && signal === "Sell") signal = "Sell";

    // Bollinger Bands confirmation
    if (latestBB) {
        if (latestClose < latestBB.lower && signal === "Buy") signal = "Buy";
        if (latestClose > latestBB.upper && signal === "Sell") signal = "Sell";
    }

    return signal;
}

// Submit order to Alpaca
async function submitOrder(symbol, qty, side) {
    try {
        const response = await axios.post(
            `${PAPER_BASE_URL}/v2/orders`,
            { symbol, qty, side, type: 'market', time_in_force: 'gtc' },
            {
                headers: {
                    'APCA-API-KEY-ID': ALPACA_API_KEY,
                    'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
                },
            }
        );
        console.log(`Order Placed: ${side.toUpperCase()} ${qty} shares of ${symbol}`);
        return response.data;
    } catch (error) {
        console.error(`Error placing order for ${symbol}:`, error.message);
    }
}

// Generate predictions and place trades
async function generatePredictions() {
    const requiredDataPoints = 35; // Maximum required data points for indicators
    const startDate = new Date().toISOString().split('T')[0] + 'T00:00:00Z';
    const predictionLog = fs.existsSync(PREDICTION_LOG_FILE) ? JSON.parse(fs.readFileSync(PREDICTION_LOG_FILE, 'utf8')) : [];

    for (const symbol of stockSymbols) {
        console.log(`Fetching data for ${symbol}...`);
        const data = await fetchIntradayData(symbol, startDate, requiredDataPoints);

        if (data.length < requiredDataPoints) {
            console.log(`Insufficient data for ${symbol}. Skipping.`);
            continue;
        }

        const indicators = calculateIndicators(data);
        const latestClose = data[data.length - 1].close;
        const signal = generateSignal(indicators, latestClose);

        if (signal === "Buy") {
            await submitOrder(symbol, QUANTITY_MIN, "buy");
        } else if (signal === "Sell") {
            await submitOrder(symbol, QUANTITY_MIN, "sell");
        }
        console.log(`Prediction for ${symbol}: ${signal}`);

        const newLogEntry = {
            symbol,
            signal,
            price: latestClose,
            time: new Date().toISOString(),
            indicators,
        };
        predictionLog.push(newLogEntry);
    }

    fs.writeFileSync(PREDICTION_LOG_FILE, JSON.stringify(predictionLog, null, 2));
    console.log('Predictions saved and trades executed.');
}

// Check if the current time is between 9:30 AM and 4:00 PM EST
function isTimeBetween930And4() {
    const now = moment().tz("America/New_York");
    const startTime = moment.tz("09:30 AM", "hh:mm A", "America/New_York");
    const endTime = moment.tz("04:00 PM", "hh:mm A", "America/New_York");
    return now.isBetween(startTime, endTime, null, "[)");
}

// Main function
async function main() {
    await generatePredictions();
    setInterval(async () => {
        if (isTimeBetween930And4()) {
            console.log('\nRefreshing data, running predictions, and placing trades...');
            await generatePredictions();
        }
    }, 20 * 60 * 1000); // 20 minutes
}

main();
