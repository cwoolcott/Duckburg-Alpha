const axios = require('axios');
const fs = require('fs');
require('dotenv').config();
const moment = require('moment-timezone');
const { RSI, MACD, BollingerBands } = require('technicalindicators');

const ALPACA_API_KEY = process.env.ALPACA_API_KEY_V7S || 'PKEKRD1334NJB5N95OJH';
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY_V7S || 'Vd9WNoHKyRbUvYzFgegRNDErphze66LdEDmhnDPu';

const MAIN_API_URL = 'https://chriscastle.com/duckburg_api/api.php'
const PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_BASE_URL = 'https://data.alpaca.markets/v2/stocks';
const PREDICTION_LOG_FILE = 'predictions_log.json';
const QUANTITY_MIN = 25;
const QUANTITY_MAX = 100;

const stockSymbols = ['PLTR', 'SOFI', 'DKNG', 'PYPL', 'COIN', 'ROKU', 'NIO', 'FUBO', 'OPEN', 'SPCE', 'NKLA', 'BB', 'AMC', 'IQ', 'STNE'];


async function symbolExists(symbol,QUANTITY_MIN){
    const response = await axios.get(
                MAIN_API_URL, 
            { 
                params: {
                    mode: "single",
                    symbol: symbol,
                    quantity: QUANTITY_MIN
            }
        }    
    );
    return  response.data.exists === "true" ? true : false;
}

async function updateQuanity(symbol,quantity,buyOrSell){
    if (buyOrSell==="sell"){
        quantity = quantity * -1;
    }
    try {
        const response = await axios.post(
            MAIN_API_URL,
            JSON.stringify({ symbol, quantity }),
            {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            }
        );
    } catch (error) {
        console.error(`Error placing order for ${symbol}:`, error.message);
    }
}

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

        const bars = response.data?.bars;
        if (!bars || bars.length === 0) {
            console.warn(`No data fetched for ${symbol}.`);
            return [];
        }

        if (bars.length < requiredDataPoints) {
            console.warn(`Not enough data fetched for ${symbol}. Only ${bars.length} bars retrieved.`);
            return [];
        }

        return bars.slice(-requiredDataPoints).map(bar => ({
            symbol,
            time: bar.t,
            close: bar.c,
            high: bar.h,
            low: bar.l,
            open: bar.o,
        }));
    } catch (error) {
        if (error.response) {
            console.error(`Error fetching data for ${symbol}:`, error.response.data);
        } else {
            console.error(`Error fetching data for ${symbol}:`, error.message);
        }
        return [];
    }
}

// Calculate technical indicators
function calculateIndicators(data) {
    const closes = data.map(d => d.close);

    if (closes.length < 35) {
        return { rsi: [], macd: [], bb: [] };
    }

    const rsi = RSI.calculate({ values: closes, period: 14 });
    const macd = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
    });
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

    console.log(`RSI: ${latestRSI}, MACD: ${latestMACD?.histogram}, BB: ${JSON.stringify(latestBB)}, Close: ${latestClose}`);

    let signal = "Hold";

    if (latestRSI !== null) {
        if (latestRSI < 40) signal = "Buy";
        if (latestRSI > 60) signal = "Sell";
    }

    if (latestMACD) {
        if (latestMACD.histogram > 0 && signal === "Buy") signal = "Buy";
        if (latestMACD.histogram < 0 && signal === "Sell") signal = "Sell";
    }

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
        return false;
    }
}



// Generate predictions and place trades
async function generatePredictions() {
    const requiredDataPoints = 35;
    const startDate = moment().subtract(7, 'days').toISOString();
    const predictionLog = fs.existsSync(PREDICTION_LOG_FILE) 
        ? JSON.parse(fs.readFileSync(PREDICTION_LOG_FILE, 'utf8')) 
        : [];

    for (const symbol of stockSymbols) {
        console.log(`Fetching data for ${symbol}...`);
        const data = await fetchIntradayData(symbol, startDate, requiredDataPoints);

        if (data.length < requiredDataPoints) {
            console.warn(`Insufficient data for ${symbol}. Skipping.`);
            continue;
        }

        const indicators = calculateIndicators(data);
        const latestClose = data[data.length - 1].close;
        const signal = generateSignal(indicators, latestClose);
        let submitResults = false;
        if (signal === "Buy") {
            submitResults = await submitOrder(symbol, QUANTITY_MIN, "buy");
            console.log("submitResults", submitResults);
            if (submitResults){
                await updateQuanity(symbol, QUANTITY_MIN, "buy");
            }
            else {
                console.log("Issue Trading " + symbol);
            }
            
        } else if (signal === "Sell") {
            const symbolInDB = await symbolExists(symbol,QUANTITY_MIN);
            if (symbolInDB){
                submitResults = await submitOrder(symbol, QUANTITY_MIN, "sell");
                console.log("submitResults", submitResults);
                if (submitResults){
                    await updateQuanity(symbol, QUANTITY_MIN, "sell");
                }
                else {
                    console.log("Issue Trading " + symbol);
                }
            }
            else{
                console.log("Can't Sell ", QUANTITY_MIN, " of ", symbol)
            }
            
        }
        

        if (submitResults){
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
        else{
            console.log(`Not Stored Prediction for ${symbol}: ${signal}`);
        }
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
    }, 30 * 60 * 1000); // 20 minutes
}

main();
