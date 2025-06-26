// utils/hubspotClient.js
const { Client } = require('@hubspot/api-client');

const hubspotClient = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });

async function updateHubSpotCompany(companyId, companyName) {
  try {
    const properties = {
      name: companyName
    };

    const SimplePublicObjectInput = { properties };
    
    const apiResponse = await hubspotClient.crm.companies.basicApi.update(
      companyId, 
      SimplePublicObjectInput
    );
    
    return apiResponse;
  } catch (error) {
    console.error('HubSpot API Error:', error);
    throw new Error(`Failed to update HubSpot company: ${error.message}`);
  }
}

async function createHubSpotCompany(companyName) {
  try {
    const properties = {
      name: companyName
    };

    const SimplePublicObjectInput = { properties };
    
    const apiResponse = await hubspotClient.crm.companies.basicApi.create(SimplePublicObjectInput);
    
    return apiResponse;
  } catch (error) {
    console.error('HubSpot API Error:', error);
    throw new Error(`Failed to create HubSpot company: ${error.message}`);
  }
}

module.exports = { updateHubSpotCompany, createHubSpotCompany };