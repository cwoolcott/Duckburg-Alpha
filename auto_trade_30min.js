const axios = require('axios');
const fs = require('fs');
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config();

// Alpaca and OpenAI credentials
const ALPACA_API_KEY = process.env.ALPACA_API_KEY;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_BASE_URL = 'https://data.alpaca.markets/v2/stocks';
const LOG_FILE = 'predictions_log.json';

const stockSymbols = ['LAAC', 'ALTM', 'ATUS', 'HBI', 'CRK', 'KOS', 'VLY', 'NGD'];

// Initialize OpenAI API (Optional for external factors, if needed in future)
// const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

// Function to fetch 30-minute interval data
async function fetchIntradayData(symbol, startDate) {
    const endpoint = `${DATA_BASE_URL}/${symbol}/bars`;
    try {
        const response = await axios.get(endpoint, {
            headers: {
                'APCA-API-KEY-ID': ALPACA_API_KEY,
                'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
            },
            params: { start: startDate, timeframe: '30Min' },
        });
        return response.data.bars.map(bar => ({
            symbol,
            time: bar.t,
            close: bar.c,
        }));
    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error.message);
        return [];
    }
}

// Submit orders to Alpaca Paper API
async function submitOrder(symbol, qty, side) {
    try {
        const response = await axios.post(
            `${PAPER_BASE_URL}/v2/orders`,
            {
                symbol,
                qty,
                side, // 'buy' or 'sell'
                type: 'market',
                time_in_force: 'gtc',
            },
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

// Save and validate predictions
function saveAndValidatePrediction(symbol, prediction, currentPrice, previousLog) {
    const now = new Date().toISOString();
    const prevEntry = previousLog.find(log => log.symbol === symbol);

    let correctness = null;

    if (prevEntry) {
        if (prevEntry.prediction === "Buy" && currentPrice > prevEntry.price) correctness = "Correct";
        if (prevEntry.prediction === "Sell" && currentPrice < prevEntry.price) correctness = "Correct";
        if ((prevEntry.prediction === "Buy" && currentPrice <= prevEntry.price) ||
            (prevEntry.prediction === "Sell" && currentPrice >= prevEntry.price)) {
            correctness = "Incorrect";
        }
    }

    const newEntry = {
        symbol,
        prediction,
        price: currentPrice,
        time: now,
        previousPrediction: prevEntry ? prevEntry.prediction : null,
        correctness: prevEntry ? correctness : "N/A",
    };

    console.log(`Logged Prediction: ${JSON.stringify(newEntry)}`);
    return newEntry;
}

// Load or initialize the prediction log
function loadPredictionLog() {
    if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, JSON.stringify([]));
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
}

// Write updated prediction log
function writePredictionLog(updatedLog) {
    fs.writeFileSync(LOG_FILE, JSON.stringify(updatedLog, null, 2));
}

// Generate predictions and place trades
async function generatePredictions() {
    const startDate = new Date().toISOString().split('T')[0] + 'T00:00:00Z';
    const predictionLog = loadPredictionLog();

    for (const symbol of stockSymbols) {
        console.log(`Fetching data for ${symbol}...`);
        const data = await fetchIntradayData(symbol, startDate);

        if (data.length < 10) {
            console.log(`Not enough data for ${symbol}.`);
            continue;
        }

        // Calculate indicators
        const shortSMA = data.slice(-5).reduce((sum, d) => sum + d.close, 0) / 5;
        const longSMA = data.slice(-10).reduce((sum, d) => sum + d.close, 0) / 10;
        const latestClose = data[data.length - 1].close;

        // Generate recommendation
        const recommendation =
            shortSMA > longSMA ? "Buy" :
            shortSMA < longSMA ? "Sell" : "Hold";

        console.log(`Symbol: ${symbol} | Recommendation: ${recommendation} | Close: ${latestClose}`);

        // Place trade if Buy/Sell
        if (recommendation === "Buy") await submitOrder(symbol, 10, "buy");
        if (recommendation === "Sell") await submitOrder(symbol, 10, "sell");

        // Save and validate prediction
        const newLogEntry = saveAndValidatePrediction(symbol, recommendation, latestClose, predictionLog);
        predictionLog.push(newLogEntry);
    }

    // Write updated log
    writePredictionLog(predictionLog);
    console.log('Predictions saved and validated.');
}

// Main function with automation every 30 minutes
async function main() {
    console.log('Starting trading model with Alpaca Paper Account and prediction logging...');
    await generatePredictions();

    // Run every 30 minutes
    setInterval(async () => {
        console.log('\nRefreshing data, running predictions, and placing trades...');
        await generatePredictions();
    }, 30 * 60 * 1000); // 30 minutes
}

main();
