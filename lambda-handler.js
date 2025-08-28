// SINOE Lambda Handler - SAM Version
const EthicalScraper = require('./src/ethicalScraper');

/**
 * AWS Lambda handler function
 * @param {Object} event - Lambda event object
 * @param {Object} context - Lambda context object
 * @returns {Object} Response object
 */
exports.handler = async (event, context) => {
  console.log('🚀 SINOE Lambda Handler Starting');
  console.log('Event:', JSON.stringify(event, null, 2));
  console.log('Context:', {
    functionName: context.functionName,
    remainingTimeInMillis: context.getRemainingTimeInMillis(),
    memoryLimitInMB: context.memoryLimitInMB
  });

  const startTime = Date.now();
  
  try {
    // Set Lambda-specific timeout
    const remainingTime = context.getRemainingTimeInMillis();
    const timeoutBuffer = 30000; // 30 seconds buffer
    const executionTimeout = remainingTime - timeoutBuffer;
    
    console.log(`⏱️ Lambda timeout: ${Math.round(executionTimeout / 1000)}s available`);
    
    // Set environment for Lambda execution
    process.env.LAMBDA_TIMEOUT = executionTimeout.toString();
    process.env.LAMBDA_CONTEXT = JSON.stringify({
      functionName: context.functionName,
      functionVersion: context.functionVersion,
      invokeid: context.invokeid,
      awsRequestId: context.awsRequestId
    });

    // Initialize scraper
    console.log('🔧 Initializing SINOE scraper...');
    const scraper = EthicalScraper.getInstance();
    
    // Run the main scraping job
    console.log('⚡ Starting scraping job...');
    const result = await scraper.runJob();
    
    const executionTime = Date.now() - startTime;
    console.log(`✅ Lambda execution completed in ${executionTime}ms`);
    
    // Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'SINOE scraping completed successfully',
        timestamp: new Date().toISOString(),
        executionTimeMs: executionTime,
        remainingTimeMs: context.getRemainingTimeInMillis(),
        result: result || 'Job completed',
        environment: {
          functionName: context.functionName,
          functionVersion: context.functionVersion,
          region: process.env.AWS_REGION || 'us-east-1'
        }
      })
    };
    
  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error('❌ Lambda execution failed:', error);
    console.error('Error stack:', error.stack);
    
    // Try to send error notification
    try {
      console.log('📧 Attempting to send error notification...');
      const scraper = EthicalScraper.getInstance();
      await scraper.sendErrorNotification(error);
      console.log('✅ Error notification sent successfully');
    } catch (notificationError) {
      console.error('❌ Failed to send error notification:', notificationError);
    }
    
    // Return error response
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        message: 'SINOE scraping failed',
        error: {
          message: error.message,
          type: error.name || 'Error',
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        },
        timestamp: new Date().toISOString(),
        executionTimeMs: executionTime,
        remainingTimeMs: context.getRemainingTimeInMillis(),
        environment: {
          functionName: context.functionName,
          functionVersion: context.functionVersion,
          region: process.env.AWS_REGION || 'us-east-1'
        }
      })
    };
    
  } finally {
    // Cleanup resources
    try {
      if (EthicalScraper.hasInstance()) {
        console.log('🧹 Cleaning up scraper instance...');
        await EthicalScraper.destroyInstance();
        console.log('✅ Cleanup completed');
      }
    } catch (cleanupError) {
      console.error('❌ Cleanup error:', cleanupError);
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`🏁 Lambda handler finished in ${totalTime}ms`);
  }
};

// For local testing
if (require.main === module) {
  console.log('🧪 Running lambda-handler locally for testing...');
  
  const mockEvent = {};
  const mockContext = {
    functionName: 'sinoe-scraper-local',
    functionVersion: '$LATEST',
    invokeid: 'test-invoke',
    awsRequestId: 'test-request-id',
    getRemainingTimeInMillis: () => 900000, // 15 minutes
    memoryLimitInMB: 2048
  };
  
  exports.handler(mockEvent, mockContext)
    .then(result => {
      console.log('✅ Local test completed');
      console.log('Result:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Local test failed:', error);
      process.exit(1);
    });
}