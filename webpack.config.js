const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => ({
  mode: argv.mode === 'production' ? 'production' : 'development',
  devtool: argv.mode === 'production' ? 'source-map' : 'cheap-module-source-map',
  entry: {
    background: './background.js',
    content: './content.js',
    popup: './popup.js',
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
            plugins: ['@babel/plugin-transform-runtime'],
          },
        },
      },
    ],
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: argv.mode === 'production',
          },
          format: {
            comments: false,
          },
        },
        extractComments: false,
      }),
    ],
    splitChunks: {
      chunks: 'all',
      minSize: 10000,
      maxSize: 250000,
    },
  },
  plugins: [
    new CleanWebpackPlugin(),
    new CopyWebpackPlugin({
      patterns: [
        { from: '*.html', to: '.' },
        { from: '*.css', to: '.' },
        { from: 'manifest.json', to: '.' },
        { from: 'images', to: 'images' },
        { from: 'config.json', to: '.', noErrorOnMissing: true },
        { from: 'domain-list.json', to: '.', noErrorOnMissing: true },
      ],
    }),
  ],
  performance: {
    hints: 'warning',
    maxEntrypointSize: 1000000,
    maxAssetSize: 1000000,
  },
});
