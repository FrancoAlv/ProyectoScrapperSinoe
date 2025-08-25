// Script para probar selectores específicos
const { EthicalScraper } = require('./index.js');

async function testSelectors() {
  const scraper = new (class extends EthicalScraper {
    constructor() {
      super();
      this.results = [];
    }
  })();

  // Test cases
  const testCases = [
    {
      url: 'https://quotes.toscrape.com/',
      selector: '.quote',
      description: 'Quotes from quotes.toscrape.com'
    },
    {
      url: 'https://httpbin.org/html',
      selector: 'h1',
      description: 'Headers from httpbin'
    },
    {
      url: 'https://example.com',
      selector: 'p',
      description: 'Paragraphs from example.com'
    }
  ];

  try {
    await scraper.initialize();
    
    for (const testCase of testCases) {
      console.log(`\n🧪 Testing: ${testCase.description}`);
      console.log(`URL: ${testCase.url}`);
      console.log(`Selector: ${testCase.selector}`);
      console.log('─'.repeat(50));
      
      const result = await scraper.scrapeUrl(testCase.url, testCase.selector);
      
      if (result.status === 'success') {
        console.log(`✅ Found ${result.dataCount} elements`);
        
        // Show first few results
        const preview = result.data.slice(0, 3);
        preview.forEach((item, index) => {
          console.log(`${index + 1}. ${item.text?.substring(0, 100)}...`);
        });
      } else {
        console.log(`❌ Failed: ${result.error}`);
      }
      
      // Wait between tests
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await scraper.close();
  }
}

// Only run if called directly
if (require.main === module) {
  testSelectors().catch(console.error);
}

module.exports = { testSelectors };