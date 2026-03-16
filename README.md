# Distance Calculator - Holcim Lafarge

## Overview
This project contains a web-based **Distance Calculator** tool (`Outil.html`) designed for estimating transport distances and costs in Algeria.

## Features
- **Interactive Map**: Built with Leaflet.js, allowing users to click and select locations directly on the map.
- **Address Autocomplete**: Powered by Geoapify to help users easily find departure and destination addresses.
- **Distance Calculation**:
  - **Straight-line (Haversine)**: Calculates the direct distance between two points.
  - **Road Distance**: Uses Geoapify Routing API to calculate the actual driving distance.
- **Price Estimation**: Provides a cost estimate based on the road distance.
- **Visual Route**: Displays the driving route on the map.

## File Structure
- `Outil.html`: The main application file containing the HTML, CSS, and JavaScript for the tool.
- `holcim_logo.png`: Logo used in the application header.
- `finalfinal.pbix` & `finalfinal.xlsx`: Project data files (Power BI and Excel contexts).

## Usage
1. Open `Outil.html` in any modern web browser.
2. Enter a **Starting Point** and **Destination** using the search bars or by clicking on the map.
3. Click the **Calculate Distance & Price** button.
4. View the results, including distances and estimated price, along with the route on the map.

## Dependencies
- **Leaflet.js**: For map rendering (loaded via CDN).
- **Geoapify API**: For geocoding, autocomplete, and routing (requires an internet connection).
