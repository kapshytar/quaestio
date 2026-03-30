package com.chataggregator.app

interface Findable {
    fun startFind(query: String)
    fun findNext()
    fun findPrev()
    fun clearFind()
}
