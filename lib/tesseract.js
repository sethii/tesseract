﻿const _ = require('lodash')
const Collection = require('./dataModels/collection')
const Session = require('./session')
const Model = require('./dataModels/model')
const {
	generateSummaryRow,
	getSimpleHeader,
	getHeader,
	createTesseractProxyConfig,
	guid
} = require('./utils')

/**
 * DataCache
 * events: dataUpdated, dataRemoved, clusterAdd, clusterRemoved, clusterUpdate
 */
class Tesseract extends Model {

	constructor({id, idProperty = 'id', resolve, columns, clusterSync}) {

        super({id, idProperty})

        this.dataMap = {}
		this.dataCache = []

        this.sessions = new Collection()
        this.id = id
        this.columns = columns
        this.resolve = resolve
        this.idProperty = idProperty
        this.clusterSync = clusterSync

		const idColumn = this.columns.find(x => x.primaryKey)
		
		if (idColumn) {
            this.idProperty = idColumn.name
        }

		this.idIndex = this.columns.findIndex(x => x.name === this.idProperty)

        // name 'removed'?
		if (this.columns.findIndex(x => x.name === 'removed' )) {
			this.columns.push({ name: 'removed', columnType: 'bool' })
		}
		
		// generating proxy config
		this.defaultObjDef = createTesseractProxyConfig(this.columns)

		this.refresh = _.throttle(() => {
			this.dataCache = this.generateData(this.dataCache)
			this.trigger('dataUpdated', this.dataCache)
		}, 100)

		this.refreshTesseract = _.throttle(silent => {
            this.dataCache.forEach(row => {
                this.generateRow(row.raw, this.columns, row)
            })
			if (!silent) {
				this.trigger('dataUpdated', this.dataCache)
			}
		}, 100)

		this.collectGarbage = _.debounce(() => {
			if(this.hasGarbage){
				this.dataCache = this.dataCache.filter(x => !x.removed)
				this.hasGarbage = false
			}
		}, 100)
	}

    get(stuff) {
        if(this[stuff]) {
            return this[stuff]
        }
    }

	createSession(config) {
        const id = config.id || guid()
        const session = new Session({
            id,
            tesseract: this,
			config,
			getTesseract: config.getTesseract
        })
		this.sessions.add(session)
		return session
	}

	getData() {
		if(this.hasGarbage){
			return this.dataCache = this.dataCache.filter(x => !x.removed)
		}
		else{
			return this.dataCache
		}
	}

	getById(id) {
		return this.dataMap[id]
	}

	add(data, disableClusterUpdate) {

        if (!data) {
            return
        }

        if (this.clusterSync && !disableClusterUpdate) {
            this.trigger('clusterAdd', data)
		}
		else{
			if (!Array.isArray(data)) {
				data = [data]
			}
			var addedRows = [];

			const idProperty = Array.isArray(data[0]) ? this.idIndex : this.idProperty

			for (var i = 0; i < data.length; i++) {
				var tempRow = this.dataMap[data[i][idProperty]];
				if (!tempRow) {
					tempRow = this.generateRow(data[i], this.columns);
					this.dataCache.push(tempRow);
				}
				addedRows.push(tempRow);
			}

			if (addedRows.length) {
				this.trigger('dataUpdated', addedRows, disableClusterUpdate)
			}
		}
	}

	update(data, reset, disableClusterUpdate) {
		var self = this;

		if (reset) {
            if (this.clusterSync && !disableClusterUpdate) {
                this.trigger('clusterUpdate', data)
			}
			else{
				updatedRows = this.dataCache = this.generateData(data);
				self.trigger('dataUpdated', this.dataCache, true)
			}
		}
		else if (data) {
			if (this.clusterSync && !disableClusterUpdate) {
                this.trigger('clusterUpdate', data)
			}
			else{

				if (!Array.isArray(data))
					data = [data];

				var updatedRows = [];
				
				var idProperty = Array.isArray(data[0]) ? this.idIndex : this.idProperty

				for (var i = 0; i < data.length; i++) {
					var tempRow = this.dataMap[data[i][idProperty]];
					if (tempRow) {
						this.generateRow(data[i], this.columns, tempRow);
					}
					else {
						tempRow = this.generateRow(data[i], this.columns);
						this.dataCache.push(tempRow);
					}
					updatedRows.push(tempRow);
				}

				if (updatedRows.length) {
					this.trigger('dataUpdated', updatedRows, disableClusterUpdate)
				}
			}
		}

		return updatedRows
	}

	remove(data, disableClusterUpdate) {
		var tempId

		if (this.get('clusterSync') && !disableClusterUpdate)
			this.trigger('clusterRemove', data)

		for (var i = 0; i < data.length; i++) {
			tempId = data[i]
			if (this.dataMap[tempId]) {
				this.dataMap[tempId].removed = true
				delete this.dataMap[tempId];
				this.collectGarbage()
			}
		}
		this.trigger('dataRemoved', data, disableClusterUpdate)
	}

	clear(disableClusterUpdate) {
		if (this.clusterSync && !disableClusterUpdate) {
            this.trigger('clusterRemove', this.dataCache)
        }

		this.trigger('dataRemoved', this.dataCache)

		this.dataCache = []
		this.dataMap = {}
	}

	updateColumns(newColumns, reset) {

		var updatedColumns = [];
		if (reset) {
			updatedColumns = newColumns;
		}
		else {
			for (var i = 0; i < this.columns.length; i++) {
				let selectedColumn = newColumns.filter((c) => c.name === this.columns[i].name)
				if (selectedColumn && selectedColumn.length) {
					selectedColumn.forEach((item) => {
						updatedColumns.push(item)
					})
				}
				else {
					updatedColumns.push(this.columns[i])
				}
			}
			newColumns.forEach((item) => {
				let selectedColumn = this.columns.find((c) => c.name === item.name)
				if (!selectedColumn) {
					updatedColumns.push(item)
				}
			});
		}

		if (updatedColumns.findIndex((x) => x.name === 'removed')) {
			updatedColumns.push({ name: 'removed', columnType: 'bool' })
        }

        this.columns = updatedColumns
		this.refreshTesseract()
    }

	generateData(data) {

		if (!data) {
            return []
        }

        return data.map(row => {
            return this.generateRow( row, this.columns)
        })
	}

	generateRow(data, columns, dataHolder = new this.defaultObjDef([])) {
		if (Array.isArray(data)) {
			dataHolder.raw = data
		}
		else {
			for(let i = 0; i < columns.length; i++) {
				var propertyValue = data[columns[i].name]
                if (propertyValue !== undefined)
				dataHolder.raw[i] = propertyValue
			}
		}

		for (var i = 0; i < columns.length; i++) {
			var propertyName = columns[i].name;
			if(columns[i].value !== undefined){
				if (typeof (columns[i].value) === 'function') {
					dataHolder.raw[i] = columns[i].value(dataHolder, propertyName);
				}
				else{
					dataHolder.raw[i] = columns[i].value
				}
			}
			if (columns[i].resolve !== undefined) {
				dataHolder.raw[i] = this.resolve(columns[i].resolve, dataHolder)
			}
		}

		this.dataMap[dataHolder.raw[this.idIndex]] = dataHolder

		return dataHolder;
	}

	renderRow(data, columns) {

		for (var i = 0; i < columns.length; i++) {
			var propertyName = columns[i].name;
			if (typeof (columns[i].value) === 'function') {
				data[propertyName] = columns[i].value(data, propertyName);
			}
			if (columns[i].resolve !== undefined) {
				data[propertyName] = this.resolve(columns[i].resolve, data)
			}
		}

		return data;
	}

	returnTree(rootIdValue, parentIdField, groups) {
		var root = this.dataMap[rootIdValue]
		if (!groups) {
            groups = _(this.dataCache)
                .groupBy(x => x[parentIdField])
                .value()
		}
		if (root) {
			var newItem = _.extend({}, root)

			newItem.children = []
			groups[newItem[this.idProperty]].forEach(x => {
				if (x[this.idProperty] !== x[parentIdField]) {
					var childrenItem = this.returnTree(x[this.idProperty], parentIdField, groups)
					newItem.children.push(childrenItem)
				}
			})

            newItem.leaf = !newItem.children.length

			return newItem
		}
	}

	getHeader(excludeHiddenColumns) {
		return getHeader(this.columns, excludeHiddenColumns)
	}

	getSimpleHeader(excludeHiddenColumns) {
		return getSimpleHeader(this.columns, excludeHiddenColumns)
	}
}

module.exports = Tesseract