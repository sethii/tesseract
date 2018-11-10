const { fromEvent } = require('rxjs')
const { map } = require('rxjs/operators')
const tape = require('tape')
const flat = require('flat')
const { tapeAssert, assertArraysMatch } = require('./utils')
const TessCluster = require('../../lib/cluster')

tape('Tesseract cluster test', t => {
    var node1 = new TessCluster()
    node1.connect({clientName: 'client1'})
        .then((nc) => {
            var users1 = node1.createTesseract('users', usersDefinition)
            var tess1 = node1.createTesseract('messageQueue', messageQueueDefinition)
            
            users1.add([{id: 1, name: 'rafal'},{id: 2, name: 'daniel'},{id: 3, name: 'lauren'}])

            let ii = 1
            tess1.add({id: ii++, message: 'dupa', user: 3, status: 1})
            tess1.add({id: ii++, message: 'cipa', user: 1, status: 1})
            tess1.add({id: ii++, message: 'bla', user: 2, status: 1})
            tess1.add({id: ii++, message: 'bla2', user: 2, status: 2})
            tess1.add({id: ii++, message: 'bla3', user: 2, status: 2})

            tess1.update({id: 2, message: 'cipa2', status: 2})
            tess1.update([{id: 5, message: 'retretrt', status: 1}, {id: 4, message: 'cipa3', status: 2}])
        })

    let node2 = new TessCluster()
    node2.connect({clientName: 'client2'})
    
    node2.on('add', (tess)=>{
        if(tess.get('id') === 'messageQueue'){
            let session = node2.createSession(messagesSession)
            
            setTimeout(()=>{
                let data = session.getData().map(i => i.object)
                    assertArraysMatch(data, dataResult, e => t.fail(e), () => t.pass('Data OK'))
                    node1.close()
                    node2.close()
                    t.end()
            }, 200)
        }
    })

    let messageQueueDefinition = {
        clusterSync: true,
        isDurableStream: true,
        columns: [{
            name: 'id',
            primaryKey: true,
        }, {
            name: 'message',
        }, {
            name: 'status',
            aggregator: 'avg'
        }, {
            name: 'user',
        }, {
            name: 'releaseTime',
            value: (data) => { return new Date() },
            aggregator: 'max'
        }, {
            name: 'tessUserName',
            resolve: {
                underlyingName: 'user',
                childrenTable: 'users',
                valueField: 'id',
                displayField: 'name'
            }
        }]
    }

    let usersDefinition = {
        clusterSync: true,
        isDurableStream: true,
        columns: [{
            name: 'id',
            primaryKey: true,
        }, {
            name: 'name',
            columnType: 'text',
        }]
    }

    let messagesSession = {
        id: 'messagesSession',
        table: 'messageQueue',
        columns:  [{
            name: 'id',
            primaryKey: true
        },{
            name: 'message',
        },{
            name: 'userName',
            resolve: {
                underlyingName: 'user',
                childrenTable: 'users',
                valueField: 'id',
                displayField: 'name'
            }
        }],
        filter: [{
            type: 'custom',
            value: 'status == 2',
        }],
        sort: [{ property: 'userName', direction: 'DESC' }]
    }

    let dataResult = [
        { id: 2, message: 'cipa2', userName: 'rafal' },
        { id: 4, message: 'cipa3', userName: 'daniel' }
    ]
})