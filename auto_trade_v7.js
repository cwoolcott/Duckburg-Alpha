const axios = require('axios');
const fs = require('fs');
require('dotenv').config();
const moment = require('moment-timezone');
const { RSI, MACD, BollingerBands } = require('technicalindicators');

const ALPACA_API_KEY = process.env.ALPACA_API_KEY_V6;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY_V6;
const PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_BASE_URL = 'https://data.alpaca.markets/v2/stocks';
const PREDICTION_LOG_FILE = 'predictions_log.json';
const QUANTITY_MIN = 25;
const QUANTITY_MAX = 100;

const stockSymbols = ['NIO', 'FUBO', 'OPEN', 'SPCE', 'NKLA', 'BB', 'AMC', 'IQ', 'STNE', 'PAGS'];

// Fetch intraday stock data
async function fetchIntradayData(symbol, startDate) {
    const endpoint = `${DATA_BASE_URL}/${symbol}/bars`;
    try {
        const response = await axios.get(endpoint, {
            headers: {
                'APCA-API-KEY-ID': ALPACA_API_KEY,
                'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
            },
            params: {
                start: startDate, // Start date for data retrieval
                timeframe: '30Min', // Interval for bars (30-minute data)
            },
        });

        return response.data.bars.map(bar => ({
            symbol,
            time: bar.t,
            close: bar.c, // Closing price
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

    const latestRSI = rsi[rsi.length - 1];
    const latestMACD = macd[macd.length - 1];
    const latestBB = bb[bb.length - 1];

    let signal = "Hold";

    // RSI-based signal
    if (latestRSI < 30) signal = "Buy"; // Oversold
    if (latestRSI > 70) signal = "Sell"; // Overbought

    // MACD-based confirmation
    if (latestMACD.histogram > 0 && signal === "Buy") signal = "Buy";
    if (latestMACD.histogram < 0 && signal === "Sell") signal = "Sell";

    // Bollinger Bands confirmation
    if (latestClose < latestBB.lower && signal === "Buy") signal = "Buy";
    if (latestClose > latestBB.upper && signal === "Sell") signal = "Sell";

    return signal;
}

// Main trading logic
async function generatePredictions() {
    const startDate = new Date().toISOString().split('T')[0] + 'T00:00:00Z';
    const predictionLog = fs.existsSync(PREDICTION_LOG_FILE) ? JSON.parse(fs.readFileSync(PREDICTION_LOG_FILE, 'utf8')) : [];

    for (const symbol of stockSymbols) {
        console.log(`Fetching data for ${symbol}...`);
        const data = await fetchIntradayData(symbol, startDate);

        if (data.length < 20) { // Ensure enough data points for indicators
            console.log(`Not enough data for ${symbol}.`);
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
