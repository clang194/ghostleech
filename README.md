# ghostleech
Client-server application which facilitates ghostleeching (leeching without tracking) torrents from private trackers

Client fetches list of peers from announce and stores in MongoDB. Also overwrites announce endpoints from .torrent files to a local endoint (Mongo server)

Server establishes MongoDB server and hosts local announce server which torrent clients will connect to with the overwritten announce endpoint in the .torrent file. 
