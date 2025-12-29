import { ProductSearchService } from '../src/services/productSearchService';
import { ProductIntentGenerator } from '../src/lib/ai/productIntentGenerator';
import { ChatGroq } from '../src/lib/ai/groq/chat_models';

async function testBroadwaySearch() {
  console.log('🧪 Testing Broadway Search API Integration\n');

  const service = new ProductSearchService();

  // Test 1: Direct service call with known working query
  console.log('Test 1: Direct service call with "shirt" query');
  try {
    const intent = {
      query_text: 'shirt',
      filters: {},
      sort: 'relevance' as const,
      limit: 5
    };

    const result = await service.searchProducts(intent);
    console.log('✅ Success!');
    console.log(`   Found ${result.results.length} products out of ${result.total} total`);
    if (result.results.length > 0) {
      console.log('   Sample product:', {
        name: result.results[0].name,
        brand: result.results[0].brand,
        type: result.results[0].type,
        imageUrl: result.results[0].imageUrl?.substring(0, 50) + '...'
      });
    }
    console.log('');
  } catch (error) {
    console.log('❌ Failed:', error instanceof Error ? error.message : String(error));
    console.log('');
  }

  // Test 2: AI Intent Generation + Service Call
  console.log('Test 2: Full pipeline - AI Intent + Broadway API');
  try {
    const intentGenerator = new ProductIntentGenerator(new ChatGroq({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
    }));

    const userQuery = 'Show me black Nike shoes';
    console.log(`   User query: "${userQuery}"`);

    const intent = await intentGenerator.generateIntent(userQuery);
    console.log('   Generated intent:', JSON.stringify(intent, null, 2));

    const result = await service.searchProducts(intent);
    console.log('✅ Success!');
    console.log(`   Found ${result.results.length} products`);
    console.log('');
  } catch (error) {
    console.log('❌ Failed:', error instanceof Error ? error.message : String(error));
    console.log('');
  }

  // Test 3: Fallback search
  console.log('Test 3: Fallback search');
  try {
    const results = await service.fallbackSearch('dress', 3);
    console.log('✅ Success!');
    console.log(`   Found ${results.length} products via fallback`);
    console.log('');
  } catch (error) {
    console.log('❌ Failed:', error instanceof Error ? error.message : String(error));
    console.log('');
  }

  console.log('🎉 Testing complete!');
}

// Run the test
testBroadwaySearch().catch(console.error);
