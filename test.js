function generatePredictions(){
    console.log("generate:")
}

setInterval(async () => {
    
    console.log('\nRefreshing data, running predictions, and placing trades...');
    await generatePredictions();
}, 5 * 1000); // 30 minutes