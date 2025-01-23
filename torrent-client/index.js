import fs from 'fs';
import bencode from 'bencode';
import crypto from 'crypto';
import { MongoClient } from 'mongodb';
import http from 'http';
import https from 'https';
import URL from 'url';
import path from 'path';

const mongoUrl = "mongodb://127.0.0.1:27017/";
let client;

async function connectToMongoDB() {
    client = new MongoClient(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();
    console.log('Connected to MongoDB');
}

async function disconnectFromMongoDB() {
    await client.close();
    console.log('Disconnected from MongoDB');
}

async function storePeers(infoHash, peers, torrentFileName, scrapeData) {
    try {
        const db = client.db('torrents');
        const collection = db.collection('peers');
        console.log('Peers:', peers);
        const result = await collection.updateOne(
            { infoHash: infoHash },
            { $set: { peers: peers, torrentFileName: torrentFileName, scrapeData: scrapeData } },
            { upsert: true }
        );
    } catch (error) {
        console.error('Error storing peers:', error);
    }
}

async function getScrapeDataFromTracker(announceUrl, infoHash) {
    const parsedUrl = new URL.URL(announceUrl);
    const scrapeUrl = `${parsedUrl.origin}${parsedUrl.pathname.replace('/announce', '/scrape')}?info_hash=${encodeURIComponent(infoHash)}`;

    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        protocol.get(scrapeUrl, (res) => {
            let data = [];
            res.on('data', (chunk) => {
                data.push(chunk);
            });
            res.on('end', () => {
                const response = Buffer.concat(data);
                try {
                    const decodedResponse = bencode.decode(response);
                    const encodedInfoHash = Buffer.from(infoHash, 'binary').toString('hex').toLowerCase();
                    const scrapeData = decodedResponse.files && decodedResponse.files[encodedInfoHash] ? decodedResponse.files[encodedInfoHash] : null;
                    resolve(scrapeData);
                } catch (error) {
                    console.error('Error decoding scrape response:', error);
                    resolve(null);
                }
            });
        }).on('error', (e) => {
            console.error(`Error fetching scrape data: ${e.message}`);
            resolve(null);
        });
    });
}

function getPeersFromTracker(announceUrl, infoHash, callback) {
    const parsedUrl = new URL.URL(announceUrl);
    const params = {
        // Generate a 20-byte peer_id
        peer_id: '-PC0001-' + crypto.randomBytes(12).toString('hex').substring(0, 20 - 8),
        port: 6881,
        uploaded: 0,
        downloaded: 0,
        left: 0,
        compact: 1,
        event: 'started'
    };
    // Correctly encode info_hash for the URL
    const encodedInfoHash = Buffer.from(infoHash, 'binary').toString('hex').toLowerCase()
                             .match(/.{1,2}/g).map(byte => `%${byte}`).join('');

    let queryString = `info_hash=${encodedInfoHash}`;
    Object.keys(params).forEach(key => {
        queryString += `&${key}=${encodeURIComponent(params[key])}`;
    });

    const requestUrl = `${parsedUrl.origin}${parsedUrl.pathname}?${queryString}`;
    //console.log(`Request URL: ${requestUrl}`);

    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    protocol.get(requestUrl, (res) => {
        let data = [];
        res.on('data', (chunk) => {
            data.push(chunk);
        });
        res.on('end', () => {
            const response = Buffer.concat(data);
            //console.log(`Response from tracker: ${response.toString('hex')}`);
            try {
                const decodedResponse = bencode.decode(response);

                if (decodedResponse.peers) {
                    //console.log(`Decoded peers: ${decodedResponse.peers}`);
                    const peers = [];
                    for (let i = 0; i < decodedResponse.peers.length; i += 6) {
                        const ip = `${decodedResponse.peers[i]}.${decodedResponse.peers[i + 1]}.${decodedResponse.peers[i + 2]}.${decodedResponse.peers[i + 3]}`;
                        const port = (decodedResponse.peers[i + 4] << 8) + decodedResponse.peers[i + 5];
                        peers.push({ ip, port });
                    }
                    //console.log(`Parsed peers: ${JSON.stringify(peers)}`);
                    callback(peers);
                } else {
                    console.log('No peers found in tracker response');
                    callback([]);
                }
            } catch (error) {
                console.error('Error decoding tracker response:', error);
                callback([]);
            }
        });
    }).on('error', (e) => {
        console.error(`Error fetching tracker: ${e.message}`);
        callback([]);
    });
}

async function getPeersAndStore(torrentFilePath) {
    console.log(`Reading torrent file: ${torrentFilePath}`);
    const torrent = bencode.decode(fs.readFileSync(torrentFilePath));
    const info = bencode.encode(torrent.info);
    const infoHash = crypto.createHash('sha1').update(info).digest('binary');

    console.log(`Generated infoHash: ${Buffer.from(infoHash, 'binary').toString('hex')}`);

    const announceList = torrent['announce-list'] ? torrent['announce-list'].flat() : [torrent.announce];
    const torrentFileName = path.basename(torrentFilePath);

    for (const announce of announceList) {
        let announceUrl = announce;
        if (announceUrl instanceof Uint8Array) {
            announceUrl = new TextDecoder().decode(announceUrl);
        }

        if (announceUrl.startsWith('udp:')) {
            //console.log(`Ignoring UDP tracker: ${announceUrl}`);
            continue;
        }

        console.log(`Processing tracker: ${announceUrl}`);

        await new Promise((resolve) => {
            getPeersFromTracker(announceUrl, infoHash, async (peers) => {
                if (peers.length > 0) {
                    const scrapeData = await getScrapeDataFromTracker(announceUrl, infoHash);
                    await storePeers(Buffer.from(infoHash, 'binary').toString('hex'), peers, torrentFileName, scrapeData);
                } else {
                    console.log(`No peers to store for infoHash: ${Buffer.from(infoHash, 'binary').toString('hex')}`);
                }
                resolve();
            });
        });
    }

    // Modify the torrent file and replace trackers with your server's announce URL
    const serverAnnounceUrl = 'http://localhost:8000/announce';
    torrent.announce = serverAnnounceUrl;
    delete torrent['announce-list'];

    // Save the modified torrent file in the "modified" subdirectory
    const modifiedTorrentDir = path.join(process.cwd(), 'modified');
    if (!fs.existsSync(modifiedTorrentDir)) {
        fs.mkdirSync(modifiedTorrentDir);
    }
    const modifiedTorrentFilePath = path.join(modifiedTorrentDir, torrentFileName);
    fs.writeFileSync(modifiedTorrentFilePath, bencode.encode(torrent));
    console.log(`Modified torrent file saved: ${modifiedTorrentFilePath}`);
}

async function processAllTorrents() {
    try {
        await connectToMongoDB();

        const torrentDir = path.join(process.cwd(), 'torrents');
        const files = await fs.promises.readdir(torrentDir);

        for (const file of files) {
            if (path.extname(file) === '.torrent') {
                const torrentFilePath = path.join(torrentDir, file);
                console.log(`Processing torrent file: ${torrentFilePath}`);
                await getPeersAndStore(torrentFilePath);
            }
        }
    } catch (error) {
        console.error('Error processing torrents:', error);
    } finally {
        await disconnectFromMongoDB();
    }
}

processAllTorrents().catch(console.error);
