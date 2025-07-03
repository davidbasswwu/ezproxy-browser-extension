#!/usr/bin/env node

/**
 * Convert domain-verification-report.json to CSV format
 * 
 * Usage: node scripts/report-to-csv.js [input-file] [output-file]
 * Default: node scripts/report-to-csv.js domain-verification-report.json domain-verification-report.csv
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);

// Default to today's date folder structure
const now = new Date();
const year = now.getFullYear().toString();
const month = now.toLocaleString('en-US', { month: 'long' });
const day = now.getDate().toString().padStart(2, '0');
const todayPath = path.join('test-results', year, month, day);

const inputFile = args[0] || path.join(todayPath, 'domain-verification-report.json');
const outputFile = args[1] || path.join(todayPath, 'domain-verification-report.csv');

function convertReportToCsv(inputPath, outputPath) {
  console.log(`📄 Converting ${inputPath} to CSV format...`);
  
  // Check if input file exists
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
  }
  
  // Load and parse JSON report
  let report;
  try {
    const jsonData = fs.readFileSync(inputPath, 'utf-8');
    report = JSON.parse(jsonData);
  } catch (error) {
    console.error(`❌ Error reading/parsing JSON file: ${error.message}`);
    process.exit(1);
  }
  
  // Prepare CSV data
  const csvRows = [];
  
  // CSV Headers
  const headers = [
    'Domain',
    'Status',
    'Type',
    'URL',
    'Timestamp',
    'Authenticated',
    'Institutional_Access_Detected',
    'Access_Indicators',
    'Elements_Found',
    'Annotated',
    'Filename',
    'Relative_Path',
    'Error_Message'
  ];
  
  csvRows.push(headers.join(','));
  
  // Process successful screenshots
  if (report.screenshots && Array.isArray(report.screenshots)) {
    report.screenshots.forEach(screenshot => {
      const row = [
        escapeCSV(screenshot.domain || ''),
        'SUCCESS',
        escapeCSV(screenshot.type || ''),
        escapeCSV(screenshot.url || ''),
        escapeCSV(screenshot.timestamp || ''),
        screenshot.authenticated ? 'TRUE' : 'FALSE',
        screenshot.institutionalAccess?.detected ? 'TRUE' : 'FALSE',
        escapeCSV((screenshot.institutionalAccess?.indicators || []).join('; ') || ''),
        screenshot.institutionalAccess?.elementsFound || 0,
        screenshot.institutionalAccess?.annotated ? 'TRUE' : 'FALSE',
        escapeCSV(screenshot.filename || ''),
        escapeCSV(screenshot.relativePath || ''),
        '' // No error for successful screenshots
      ];
      
      csvRows.push(row.join(','));
    });
  }
  
  // Process errors
  if (report.errors && Array.isArray(report.errors)) {
    report.errors.forEach(error => {
      const row = [
        escapeCSV(error.domain || ''),
        'ERROR',
        escapeCSV(error.type || ''),
        escapeCSV(error.url || ''),
        escapeCSV(error.timestamp || ''),
        'FALSE', // Assume no authentication for errors
        'FALSE', // No institutional access for errors
        '', // No indicators for errors
        0, // No elements found for errors
        'FALSE', // No annotation for errors
        '', // No filename for errors
        '', // No path for errors
        escapeCSV(error.error || '')
      ];
      
      csvRows.push(row.join(','));
    });
  }
  
  // Write CSV file
  try {
    fs.writeFileSync(outputPath, csvRows.join('\n'), 'utf-8');
    console.log(`✅ CSV file created: ${outputPath}`);
    
    // Show summary
    const successCount = report.screenshots ? report.screenshots.length : 0;
    const errorCount = report.errors ? report.errors.length : 0;
    const totalRows = successCount + errorCount;
    const institutionalAccessCount = report.summary?.institutionalAccess?.totalDetected || 0;
    
    console.log('\n📊 CONVERSION SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total rows written: ${totalRows}`);
    console.log(`Successful screenshots: ${successCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Institutional access detected: ${institutionalAccessCount}`);
    console.log(`Report timestamp: ${report.timestamp || 'Unknown'}`);
    
  } catch (error) {
    console.error(`❌ Error writing CSV file: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Escape CSV field values that contain commas, quotes, or newlines
 */
function escapeCSV(value) {
  if (typeof value !== 'string') {
    return String(value);
  }
  
  // If the value contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  
  return value;
}

// Run the conversion
if (require.main === module) {
  const inputPath = path.resolve(inputFile);
  const outputPath = path.resolve(outputFile);
  
  console.log(`Input: ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log('');
  
  convertReportToCsv(inputPath, outputPath);
}

module.exports = { convertReportToCsv };