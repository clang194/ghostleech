# ghostleech
Client-server application which facilitates ghostleeching (leeching without tracking) torrents from private trackers

Client fetches list of peers from announce and stores in MongoDB. It also overwrites announce endpoints from .torrent files to a local endpoint (Mongo server)

Server establishes MongoDB server and hosts local announce server which torrent clients will connect to using the overwritten announce endpoint in the .torrent file. 
