package com.chataggregator.app

import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.viewpager2.adapter.FragmentStateAdapter

class ChatPagerAdapter(
    activity: FragmentActivity,
    private val slotCount: Int,
    private val hasMergeTab: Boolean
) : FragmentStateAdapter(activity) {

    private val fragments = mutableMapOf<Int, ChatFragment>()
    private var mergeFragment: MergeFragment? = null

    override fun getItemCount(): Int = slotCount + if (hasMergeTab) 1 else 0

    override fun createFragment(position: Int): Fragment {
        if (hasMergeTab && position == slotCount) {
            val fragment = MergeFragment()
            mergeFragment = fragment
            return fragment
        }
        val fragment = ChatFragment.newInstance(position)
        fragments[position] = fragment
        return fragment
    }

    fun getFragment(position: Int): ChatFragment? = fragments[position]

    fun getMergeFragment(): MergeFragment? = mergeFragment
}
