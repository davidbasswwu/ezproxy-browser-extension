#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const files = [
  'config.json',
  'domain-list.json',
  'background.js',
  'content.js',
  'popup.js',
  'popup.html',
  'popup.css'
];

console.log('Generating SRI hashes for files:');
console.log('--------------------------------');

files.forEach(file => {
  try {
    const filePath = path.resolve(__dirname, '../', file);
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha384').update(fileContent).digest('base64');
      console.log(`${file}: sha384-${hash}`);
    } else {
      console.log(`${file}: File not found`);
    }
  } catch (error) {
    console.error(`Error processing ${file}:`, error.message);
  }
});

console.log('\nAdd these hashes to your manifest.json or HTML files as needed.');
