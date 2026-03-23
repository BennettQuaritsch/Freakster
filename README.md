# Freakster - Create your own Hitster

This project allows you to load the data of a spotify playlist and creates hitster-like cards for printing with the songs of the playlist.

## How to run

Clone the repo. Create a `.env` file based on the `.env.template` file. Go to the spotify developer site and register an app. Get the client id and client secret and fill them in. Set the correct redirect url in the developer dashboard.

Then use `generate_list.py` to generate a json with the song data and `generate_images.py` after that for the cards creation. 